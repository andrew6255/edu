-- Privacy-safe profile access primitives. Safe to rerun after
-- supabase_schema.sql and classroom_rls.sql. The separate lock migration removes
-- legacy broad profile policies only after the matching web/API build is live.

begin;

create or replace view profile_directory
with (security_barrier = true)
as
select
  id,
  username,
  first_name,
  last_name,
  role,
  nullif(user_state->>'friendCode', '') as friend_tag
from profiles;

-- `authenticated` must be revoked explicitly: Supabase default privileges grant
-- ALL on new objects in `public` to the client roles, and revoking from the
-- PUBLIC pseudo-role does not remove those. The view is owner-run (not
-- security_invoker), so any leftover write privilege would bypass profiles RLS.
revoke all on profile_directory from public, anon, authenticated;
grant select on profile_directory to authenticated;

create or replace function rls_can_read_private_profile(p_target_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_id text := auth.uid()::text;
  v_actor_role text;
begin
  if v_actor_id is null or p_target_id is null then return false; end if;
  if v_actor_id = p_target_id then return true; end if;

  select role into v_actor_role from profiles where id = v_actor_id;
  if v_actor_role = 'superadmin' then return true; end if;

  if v_actor_role = 'admin' then
    return
      exists (
        select 1 from admin_teacher_assignments a
        where a.admin_id = v_actor_id and a.teacher_id = p_target_id
      )
      or exists (
        select 1
        from admin_teacher_assignments a
        join classes c on c.teacher_id = a.teacher_id
        join class_members m on m.class_id = c.id
        where a.admin_id = v_actor_id and m.user_id = p_target_id
      )
      or exists (
        select 1
        from admin_teacher_assignments a
        join classes c on c.teacher_id = a.teacher_id
        join class_members m on m.class_id = c.id
        join parent_student_links l on l.student_id = m.user_id
        where a.admin_id = v_actor_id and l.parent_id = p_target_id
      )
      or exists (
        select 1 from global_docs d
        join admin_teacher_assignments a on a.teacher_id = d.data->>'teacherId'
        where d.collection = 'teacherClassrooms'
          and a.admin_id = v_actor_id
          and coalesce(d.data->'participantIds', '[]'::jsonb) ? p_target_id
      );
  end if;

  if v_actor_role = 'teacher' then
    return
      exists (
        select 1 from classes c
        join class_members m on m.class_id = c.id
        where c.teacher_id = v_actor_id and m.user_id = p_target_id
      )
      or exists (
        select 1 from classes c
        join class_members m on m.class_id = c.id
        join parent_student_links l on l.student_id = m.user_id
        where c.teacher_id = v_actor_id and l.parent_id = p_target_id
      )
      or exists (
        select 1 from global_docs d
        where d.collection = 'teacherClassrooms'
          and d.data->>'teacherId' = v_actor_id
          and coalesce(d.data->'participantIds', '[]'::jsonb) ? p_target_id
      );
  end if;

  if v_actor_role = 'teacher_assistant' then
    return exists (
      select 1 from class_members mine
      join class_members other_member on other_member.class_id = mine.class_id
      where mine.user_id = v_actor_id
        and mine.role = 'teacher_assistant'
        and other_member.user_id = p_target_id
    );
  end if;

  if v_actor_role = 'parent' then
    return exists (
      select 1 from parent_student_links l
      where l.parent_id = v_actor_id and l.student_id = p_target_id
    );
  end if;

  return false;
end;
$$;

revoke all on function rls_can_read_private_profile(text) from public;
grant execute on function rls_can_read_private_profile(text) to authenticated;

create or replace function get_friend_presence(p_ids text[])
returns table(id text, username text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select target.id, coalesce(target.username, ''), target.updated_at
  from profiles me
  join profiles target
    on target.id = any(coalesce(p_ids, array[]::text[]))
   and coalesce(me.user_state->'friends', '[]'::jsonb) ? target.id
  where me.id = auth.uid()::text
  limit 200;
$$;

revoke all on function get_friend_presence(text[]) from public;
grant execute on function get_friend_presence(text[]) to authenticated;

commit;
