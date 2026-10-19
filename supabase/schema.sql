create extension if not exists pgcrypto;

create table if not exists public.private_farms (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sessions integer not null default 0 check (sessions >= 0),
  total_seconds bigint not null default 0 check (total_seconds >= 0),
  tree_inventory jsonb not null default '{}'::jsonb,
  tree_progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_farms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 48),
  invite_code text not null unique check (char_length(invite_code) = 8),
  created_by uuid not null references auth.users (id) on delete cascade,
  sessions integer not null default 0 check (sessions >= 0),
  total_seconds bigint not null default 0 check (total_seconds >= 0),
  tree_inventory jsonb not null default '{}'::jsonb,
  tree_progress jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'private_farms' and column_name = 'tree_inventory'
  ) then
    alter table public.private_farms
      add column tree_inventory jsonb not null default '{}'::jsonb,
      add column tree_progress jsonb not null default '{}'::jsonb;
    update public.private_farms
    set tree_inventory = jsonb_build_object('oak', sessions)
    where sessions > 0;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shared_farms' and column_name = 'tree_inventory'
  ) then
    alter table public.shared_farms
      add column tree_inventory jsonb not null default '{}'::jsonb,
      add column tree_progress jsonb not null default '{}'::jsonb;
    update public.shared_farms
    set tree_inventory = jsonb_build_object('oak', sessions)
    where sessions > 0;
  end if;
end;
$$;

create table if not exists public.farm_members (
  farm_id uuid not null references public.shared_farms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create unique index if not exists farm_members_one_shared_farm_per_user
  on public.farm_members (user_id);

alter table public.farm_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'farm_members_role_check'
      and conrelid = 'public.farm_members'::regclass
  ) then
    alter table public.farm_members
      add constraint farm_members_role_check check (role in ('member', 'admin'));
  end if;
end;
$$;

create table if not exists public.farm_tasks (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid references public.shared_farms (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  period text not null check (period in ('day', 'week')),
  task_type text not null check (task_type in ('personal', 'main', 'assigned')),
  completion_mode text not null check (completion_mode in ('all', 'first')),
  completed_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((farm_id is null and owner_id is not null and task_type = 'personal')
    or (farm_id is not null and owner_id is null and task_type in ('main', 'assigned')))
);
alter table public.farm_tasks
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.farm_task_assignments (
  task_id uuid not null references public.farm_tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  completed_at timestamptz,
  primary key (task_id, user_id)
);

create or replace function public.is_shared_farm_manager(p_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_farms f
    left join public.farm_members m
      on m.farm_id = f.id and m.user_id = auth.uid()
    where f.id = p_farm_id
      and (f.created_by = auth.uid() or m.role = 'admin')
  );
$$;

create or replace function public.is_shared_farm_member(p_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.farm_members
    where farm_id = p_farm_id and user_id = auth.uid()
  );
$$;

create or replace function public.can_read_farm_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.farm_tasks t
    where t.id = p_task_id
      and (
        t.owner_id = auth.uid()
        or (
          t.farm_id is not null
          and public.is_shared_farm_member(t.farm_id)
          and (
            t.task_type = 'main'
            or public.is_shared_farm_manager(t.farm_id)
            or t.created_by = auth.uid()
            or exists (
              select 1 from public.farm_task_assignments a
              where a.task_id = t.id and a.user_id = auth.uid()
            )
          )
        )
      )
  );
$$;

create or replace function public.initialize_private_farm()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  insert into public.private_farms (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.create_shared_farm(p_name text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm public.shared_farms;
  v_name text := nullif(trim(p_name), '');
  v_display_name text := nullif(trim(p_display_name), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_name is null or char_length(v_name) > 48 then
    raise exception 'Farm name must be between 1 and 48 characters';
  end if;
  if v_display_name is null or char_length(v_display_name) > 24 then
    raise exception 'Display name must be between 1 and 24 characters';
  end if;
  if exists (
    select 1 from public.farm_members where user_id = auth.uid()
  ) then
    raise exception 'You already belong to a shared farm';
  end if;

  insert into public.shared_farms (name, invite_code, created_by)
  values (v_name, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), auth.uid())
  returning * into v_farm;

  insert into public.farm_members (farm_id, user_id, display_name)
  values (v_farm.id, auth.uid(), v_display_name);

  return jsonb_build_object('farm_id', v_farm.id, 'invite_code', v_farm.invite_code, 'name', v_farm.name);
end;
$$;

create or replace function public.join_shared_farm(p_invite_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm public.shared_farms;
  v_display_name text := nullif(trim(p_display_name), '');
  v_is_member boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_display_name is null or char_length(v_display_name) > 24 then
    raise exception 'Display name must be between 1 and 24 characters';
  end if;

  select * into v_farm
  from public.shared_farms
  where invite_code = upper(trim(p_invite_code))
  for update;
  if not found then
    raise exception 'Invitation code not found';
  end if;

  select exists (
    select 1 from public.farm_members
    where farm_id = v_farm.id and user_id = auth.uid()
  ) into v_is_member;
  if exists (
    select 1 from public.farm_members
    where user_id = auth.uid() and farm_id <> v_farm.id
  ) then
    raise exception 'You already belong to another shared farm';
  end if;
  if not v_is_member and (
    select count(*) from public.farm_members where farm_id = v_farm.id
  ) >= 3 then
    raise exception 'This farm already has three members';
  end if;

  insert into public.farm_members (farm_id, user_id, display_name)
  values (v_farm.id, auth.uid(), v_display_name)
  on conflict (farm_id, user_id) do update set display_name = excluded.display_name;

  return jsonb_build_object('farm_id', v_farm.id, 'invite_code', v_farm.invite_code, 'name', v_farm.name);
end;
$$;

create or replace function public.set_farm_member_role(
  p_farm_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.shared_farms
    where id = p_farm_id and created_by = auth.uid()
  ) then
    raise exception 'Only the farm owner can manage admin roles';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Invalid member role';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'The farm owner role cannot be changed';
  end if;
  update public.farm_members
  set role = p_role
  where farm_id = p_farm_id and user_id = p_user_id;
  if not found then
    raise exception 'Farm member not found';
  end if;
end;
$$;

create or replace function public.remove_farm_member(p_farm_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_target_role text;
begin
  if not public.is_shared_farm_manager(p_farm_id) then
    raise exception 'Only farm managers can remove members';
  end if;
  select created_by into v_owner_id
  from public.shared_farms
  where id = p_farm_id;
  if not found then
    raise exception 'Shared farm not found';
  end if;
  if p_user_id = v_owner_id or p_user_id = auth.uid() then
    raise exception 'The owner or acting manager cannot be removed this way';
  end if;
  select role into v_target_role
  from public.farm_members
  where farm_id = p_farm_id and user_id = p_user_id;
  if not found then
    raise exception 'Farm member not found';
  end if;
  if v_target_role = 'admin' and not exists (
    select 1 from public.shared_farms
    where id = p_farm_id and created_by = auth.uid()
  ) then
    raise exception 'Admins cannot remove another admin';
  end if;
  delete from public.farm_task_assignments
  where user_id = p_user_id
    and task_id in (
      select id from public.farm_tasks where farm_id = p_farm_id and completed_at is null
    );
  update public.farm_tasks t
  set updated_at = now(), completed_by = auth.uid(), completed_at = now()
  where t.farm_id = p_farm_id
    and t.completed_at is null
    and t.completion_mode = 'all'
    and not exists (
      select 1 from public.farm_task_assignments a
      where a.task_id = t.id and a.completed_at is null
    );
  delete from public.farm_tasks t
  where t.farm_id = p_farm_id
    and t.completed_at is null
    and t.completion_mode = 'first'
    and not exists (
      select 1 from public.farm_task_assignments a where a.task_id = t.id
    );
  delete from public.farm_members
  where farm_id = p_farm_id and user_id = p_user_id;
end;
$$;

create or replace function public.create_farm_task(
  p_farm_id uuid,
  p_title text,
  p_period text,
  p_task_type text,
  p_completion_mode text,
  p_assignee_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_title text := nullif(trim(p_title), '');
  v_assignee_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_title is null or char_length(v_title) > 120 then
    raise exception 'Task title must be between 1 and 120 characters';
  end if;
  if p_period not in ('day', 'week') then
    raise exception 'Invalid task period';
  end if;

  if p_farm_id is null then
    if p_task_type <> 'personal' then
      raise exception 'Invalid personal task type';
    end if;
    insert into public.farm_tasks (owner_id, created_by, title, period, task_type, completion_mode)
    values (auth.uid(), auth.uid(), v_title, p_period, 'personal', 'first')
    returning id into v_task_id;
    insert into public.farm_task_assignments (task_id, user_id)
    values (v_task_id, auth.uid());
    return v_task_id;
  end if;

  if not public.is_shared_farm_member(p_farm_id) then
    raise exception 'You are not a member of this shared farm';
  end if;
  if p_task_type not in ('main', 'assigned') then
    raise exception 'Invalid shared task type';
  end if;
  if p_completion_mode not in ('all', 'first') then
    raise exception 'Invalid completion mode';
  end if;

  if p_task_type = 'main' then
    if p_completion_mode <> 'all' then
      raise exception 'Main tasks must be completed by every member';
    end if;
    select array_agg(user_id) into v_assignee_ids
    from public.farm_members
    where farm_id = p_farm_id;
  else
    select array_agg(distinct input.assignee_id) into v_assignee_ids
    from unnest(coalesce(p_assignee_ids, array[]::uuid[])) as input(assignee_id);
    if coalesce(cardinality(v_assignee_ids), 0) = 0 then
      raise exception 'At least one assignee is required';
    end if;
    if not public.is_shared_farm_manager(p_farm_id)
      and exists (
        select 1 from unnest(v_assignee_ids) as input(assignee_id)
        where input.assignee_id <> auth.uid()
      ) then
      raise exception 'Only farm managers can assign tasks to other members';
    end if;
    if exists (
      select 1 from unnest(v_assignee_ids) as input(assignee_id)
      where not exists (
        select 1 from public.farm_members
        where farm_id = p_farm_id and user_id = input.assignee_id
      )
    ) then
      raise exception 'All assignees must belong to this farm';
    end if;
  end if;

  insert into public.farm_tasks (
    farm_id, created_by, title, period, task_type, completion_mode
  )
  values (
    p_farm_id, auth.uid(), v_title, p_period, p_task_type, p_completion_mode
  )
  returning id into v_task_id;
  insert into public.farm_task_assignments (task_id, user_id)
  select v_task_id, input.assignee_id
  from unnest(v_assignee_ids) as input(assignee_id);
  return v_task_id;
end;
$$;

create or replace function public.complete_farm_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.farm_tasks;
begin
  select * into v_task from public.farm_tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;
  if v_task.completed_at is not null then
    return;
  end if;
  if v_task.farm_id is not null and not public.is_shared_farm_member(v_task.farm_id) then
    raise exception 'You are not a member of this shared farm';
  end if;
  update public.farm_task_assignments
  set completed_at = now()
  where task_id = p_task_id and user_id = auth.uid() and completed_at is null;
  if not found then
    raise exception 'This task is not assigned to you or is already complete';
  end if;
  update public.farm_tasks set updated_at = now() where id = p_task_id;
  if v_task.completion_mode = 'first' or not exists (
    select 1 from public.farm_task_assignments
    where task_id = p_task_id and completed_at is null
  ) then
    update public.farm_tasks
    set completed_by = auth.uid(), completed_at = now()
    where id = p_task_id;
  end if;
end;
$$;

create or replace function public.update_farm_task(
  p_task_id uuid,
  p_title text,
  p_period text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.farm_tasks;
  v_title text := nullif(trim(p_title), '');
begin
  if v_title is null or char_length(v_title) > 120 then
    raise exception 'Task title must be between 1 and 120 characters';
  end if;
  if p_period not in ('day', 'week') then
    raise exception 'Invalid task period';
  end if;
  select * into v_task from public.farm_tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;
  if v_task.completed_at is not null then
    raise exception 'Completed tasks cannot be edited';
  end if;
  if v_task.farm_id is null then
    if v_task.owner_id <> auth.uid() then
      raise exception 'You cannot edit this task';
    end if;
  elsif not public.is_shared_farm_member(v_task.farm_id) then
    raise exception 'You are not a member of this shared farm';
  end if;
  update public.farm_tasks
  set title = v_title, period = p_period, updated_at = now()
  where id = p_task_id;
end;
$$;

create or replace function public.delete_farm_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.farm_tasks;
begin
  select * into v_task from public.farm_tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;
  if v_task.farm_id is null then
    if v_task.owner_id <> auth.uid() then
      raise exception 'You cannot delete this task';
    end if;
  elsif not public.is_shared_farm_manager(v_task.farm_id) then
    raise exception 'Only farm managers can delete shared tasks';
  end if;
  delete from public.farm_tasks where id = p_task_id;
end;
$$;

drop function if exists public.record_focus(integer, uuid);

create or replace function public.record_focus(
  p_seconds integer,
  p_shared_farm_id uuid default null,
  p_tree_type text default 'oak'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_private public.private_farms;
  v_shared public.shared_farms;
  v_tree_minutes integer;
  v_private_progress integer;
  v_shared_progress integer;
  v_private_inventory jsonb;
  v_shared_inventory jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > 10800 then
    raise exception 'Focus duration must be between 1 and 10800 seconds';
  end if;
  v_tree_minutes := case p_tree_type
    when 'olive' then 30
    when 'apple' then 45
    when 'oak' then 60
    when 'pine' then 90
    when 'palm' then 120
    when 'bamboo' then 150
    when 'cherry' then 180
    when 'maple' then 240
    when 'cypress' then 300
    when 'baobab' then 360
    when 'mangrove' then 480
    when 'redwood' then 600
    else null
  end;
  if v_tree_minutes is null then
    raise exception 'Unknown tree type';
  end if;

  insert into public.private_farms (user_id, sessions, total_seconds)
  values (auth.uid(), 1, p_seconds)
  on conflict (user_id) do update
  set sessions = public.private_farms.sessions + 1,
      total_seconds = public.private_farms.total_seconds + excluded.total_seconds,
      updated_at = now()
  returning * into v_private;

  v_private_progress := coalesce((v_private.tree_progress ->> p_tree_type)::integer, 0) + p_seconds;
  v_private_inventory := v_private.tree_inventory;
  while v_private_progress >= v_tree_minutes * 60 loop
    v_private_progress := v_private_progress - v_tree_minutes * 60;
    v_private_inventory := jsonb_set(
      v_private_inventory,
      array[p_tree_type],
      to_jsonb(coalesce((v_private_inventory ->> p_tree_type)::integer, 0) + 1),
      true
    );
  end loop;
  update public.private_farms
  set tree_inventory = v_private_inventory,
      tree_progress = jsonb_set(tree_progress, array[p_tree_type], to_jsonb(v_private_progress), true)
  where user_id = auth.uid()
  returning * into v_private;

  if p_shared_farm_id is not null then
    if not public.is_shared_farm_member(p_shared_farm_id) then
      raise exception 'You are not a member of this shared farm';
    end if;
    select * into v_shared
    from public.shared_farms
    where id = p_shared_farm_id
    for update;
    v_shared_progress := coalesce((v_shared.tree_progress ->> p_tree_type)::integer, 0) + p_seconds;
    v_shared_inventory := v_shared.tree_inventory;
    while v_shared_progress >= v_tree_minutes * 60 loop
      v_shared_progress := v_shared_progress - v_tree_minutes * 60;
      v_shared_inventory := jsonb_set(
        v_shared_inventory,
        array[p_tree_type],
        to_jsonb(coalesce((v_shared_inventory ->> p_tree_type)::integer, 0) + 1),
        true
      );
    end loop;
    update public.shared_farms
    set sessions = sessions + 1,
        total_seconds = total_seconds + p_seconds,
        tree_inventory = v_shared_inventory,
        tree_progress = jsonb_set(tree_progress, array[p_tree_type], to_jsonb(v_shared_progress), true)
    where id = p_shared_farm_id
    returning * into v_shared;
  end if;

  return jsonb_build_object(
    'private', jsonb_build_object(
      'sessions', v_private.sessions,
      'total_seconds', v_private.total_seconds,
      'tree_inventory', v_private.tree_inventory,
      'tree_progress', v_private.tree_progress
    ),
    'shared', case when v_shared.id is null then null else jsonb_build_object(
      'id', v_shared.id, 'name', v_shared.name, 'invite_code', v_shared.invite_code,
      'sessions', v_shared.sessions, 'total_seconds', v_shared.total_seconds,
      'tree_inventory', v_shared.tree_inventory, 'tree_progress', v_shared.tree_progress
    ) end
  );
end;
$$;

alter table public.private_farms enable row level security;
alter table public.shared_farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.farm_tasks enable row level security;
alter table public.farm_task_assignments enable row level security;

drop policy if exists "Users can read their private farm" on public.private_farms;
create policy "Users can read their private farm"
  on public.private_farms for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Members can read their shared farms" on public.shared_farms;
create policy "Members can read their shared farms"
  on public.shared_farms for select to authenticated
  using (public.is_shared_farm_member(id));

drop policy if exists "Members can read farm member names" on public.farm_members;
create policy "Members can read farm member names"
  on public.farm_members for select to authenticated
  using (public.is_shared_farm_member(farm_id));

drop policy if exists "Users can read their own or shared farm tasks" on public.farm_tasks;
create policy "Users can read their own or shared farm tasks"
  on public.farm_tasks for select to authenticated
  using (public.can_read_farm_task(id));

drop policy if exists "Users can read assignments for visible tasks" on public.farm_task_assignments;
create policy "Users can read assignments for visible tasks"
  on public.farm_task_assignments for select to authenticated
  using (public.can_read_farm_task(task_id));

revoke all on public.private_farms, public.shared_farms, public.farm_members,
  public.farm_tasks, public.farm_task_assignments from anon, authenticated;
grant select on public.private_farms, public.shared_farms, public.farm_members,
  public.farm_tasks, public.farm_task_assignments to authenticated;
revoke all on function public.is_shared_farm_member(uuid) from public, anon;
revoke all on function public.is_shared_farm_manager(uuid) from public, anon;
revoke all on function public.can_read_farm_task(uuid) from public, anon;
revoke all on function public.initialize_private_farm() from public, anon;
revoke all on function public.create_shared_farm(text, text) from public, anon;
revoke all on function public.join_shared_farm(text, text) from public, anon;
revoke all on function public.set_farm_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_farm_member(uuid, uuid) from public, anon;
revoke all on function public.create_farm_task(uuid, text, text, text, text, uuid[]) from public, anon;
revoke all on function public.complete_farm_task(uuid) from public, anon;
revoke all on function public.update_farm_task(uuid, text, text) from public, anon;
revoke all on function public.delete_farm_task(uuid) from public, anon;
revoke all on function public.record_focus(integer, uuid, text) from public, anon;
grant execute on function public.is_shared_farm_member(uuid) to authenticated;
grant execute on function public.is_shared_farm_manager(uuid) to authenticated;
grant execute on function public.can_read_farm_task(uuid) to authenticated;
grant execute on function public.initialize_private_farm() to authenticated;
grant execute on function public.create_shared_farm(text, text) to authenticated;
grant execute on function public.join_shared_farm(text, text) to authenticated;
grant execute on function public.set_farm_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_farm_member(uuid, uuid) to authenticated;
grant execute on function public.create_farm_task(uuid, text, text, text, text, uuid[]) to authenticated;
grant execute on function public.complete_farm_task(uuid) to authenticated;
grant execute on function public.update_farm_task(uuid, text, text) to authenticated;
grant execute on function public.delete_farm_task(uuid) to authenticated;
grant execute on function public.record_focus(integer, uuid, text) to authenticated;

alter table public.shared_farms replica identity full;
alter table public.farm_members replica identity full;
alter table public.farm_tasks replica identity full;
alter table public.farm_task_assignments replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_farms'
  ) then
    alter publication supabase_realtime add table public.shared_farms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'farm_members'
  ) then
    alter publication supabase_realtime add table public.farm_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'farm_tasks'
  ) then
    alter publication supabase_realtime add table public.farm_tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'farm_task_assignments'
  ) then
    alter publication supabase_realtime add table public.farm_task_assignments;
  end if;
end;
$$;
