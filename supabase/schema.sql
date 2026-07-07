-- ============================================================
-- HMSA 영업활동 대시보드 - Supabase Schema
-- Supabase SQL Editor에 전체 복사 → Run 하면 끝.
-- ============================================================

-- ---------- 1. 직원 명단 (화이트리스트) ----------
create table public.staff (
  id          bigint generated always as identity primary key,
  name        text not null,
  emp_no      text not null,            -- 사번 (가입 시 본인확인용)
  part        text not null default '미지정',
  role        text not null default 'member' check (role in ('member','leader','director')),
  is_admin    boolean not null default false,  -- 시스템 관리자 (계정 승인 권한)
  status      text not null default 'unclaimed'
              check (status in ('unclaimed','pending','active','disabled')),
  user_id     uuid unique references auth.users(id),
  login_id    text unique,
  created_at  timestamptz not null default now()
);

-- ---------- 2. 영업활동 ----------
create table public.activities (
  id            bigint generated always as identity primary key,
  type          text not null check (type in ('meeting','vc','trip','other')),
  customer      text not null,
  title         text not null,
  activity_date date not null,
  notes         text,
  created_by    bigint not null references public.staff(id),
  part          text not null,
  created_at    timestamptz not null default now()
);

create table public.activity_participants (
  activity_id bigint not null references public.activities(id) on delete cascade,
  staff_id    bigint not null references public.staff(id),
  p_role      text not null default 'participant' check (p_role in ('host','participant')),
  primary key (activity_id, staff_id)
);

-- ---------- 3. 면담록 ----------
create table public.reports (
  id           bigint generated always as identity primary key,
  activity_id  bigint references public.activities(id) on delete set null,
  title        text not null,
  customer     text not null,
  meeting_date date not null,
  content      text not null default '',
  followup     text default '',
  status       text not null default 'draft'
               check (status in ('draft','submitted','returned','approved')),
  version      int not null default 1,
  author_id    bigint not null references public.staff(id),
  part         text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 면담록 이력 (제출/반송/승인/수정 - 감사 로그, 삭제 불가)
create table public.report_events (
  id         bigint generated always as identity primary key,
  report_id  bigint not null references public.reports(id) on delete cascade,
  actor_id   bigint not null references public.staff(id),
  action     text not null check (action in ('create','edit','submit','return','approve','comment')),
  comment    text,
  version    int not null default 1,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 헬퍼 함수 (RLS에서 사용)
-- ============================================================
create or replace function public.my_staff() returns public.staff
language sql stable security definer set search_path = public as $$
  select * from staff where user_id = auth.uid() limit 1;
$$;

create or replace function public.my_staff_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from staff where user_id = auth.uid() and status = 'active' limit 1;
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from staff where user_id = auth.uid() and status = 'active' limit 1;
$$;

create or replace function public.my_part() returns text
language sql stable security definer set search_path = public as $$
  select part from staff where user_id = auth.uid() and status = 'active' limit 1;
$$;

create or replace function public.am_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from staff
    where user_id = auth.uid() and status = 'active' limit 1), false);
$$;

create or replace function public.am_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from staff where user_id = auth.uid() and status = 'active');
$$;

-- ============================================================
-- RLS 정책
-- ============================================================
alter table public.staff enable row level security;
alter table public.activities enable row level security;
alter table public.activity_participants enable row level security;
alter table public.reports enable row level security;
alter table public.report_events enable row level security;

-- ---------- staff ----------
-- 활성 사용자는 전체 명단 조회 가능 (참여자 선택/대시보드 이름 표시용)
create policy staff_select on public.staff for select
  to authenticated using ( am_active() or user_id = auth.uid() );

-- 관리자만 명단 추가/수정/삭제
create policy staff_admin_insert on public.staff for insert
  to authenticated with check ( am_admin() );
create policy staff_admin_update on public.staff for update
  to authenticated using ( am_admin() );
create policy staff_admin_delete on public.staff for delete
  to authenticated using ( am_admin() and status = 'unclaimed' );

-- 가입 화면용: 미배정 명단 (이름/파트만 노출, 사번은 미노출)
create or replace view public.signup_roster
with (security_invoker = off) as
  select id, name, part from public.staff where status = 'unclaimed';
grant select on public.signup_roster to anon, authenticated;

-- 가입 신청 (본인확인: 사번 대조) - security definer RPC
-- 로그인은 아이디 + 비밀번호. 아이디는 내부적으로 {id}@hmsa.app 형식으로 저장됨 (실제 메일 발송 없음)
create or replace function public.claim_account(p_staff_id bigint, p_emp_no text, p_login_id text)
returns text language plpgsql security definer set search_path = public as $$
declare v_staff staff;
begin
  if auth.uid() is null then return 'not_authenticated'; end if;
  if exists(select 1 from staff where user_id = auth.uid()) then return 'already_claimed'; end if;
  select * into v_staff from staff where id = p_staff_id for update;
  if v_staff is null or v_staff.status <> 'unclaimed' then return 'not_available'; end if;
  if trim(v_staff.emp_no) <> trim(p_emp_no) then return 'emp_no_mismatch'; end if;
  if exists(select 1 from staff where login_id = lower(p_login_id)) then return 'login_id_taken'; end if;
  update staff set user_id = auth.uid(), login_id = lower(p_login_id), status = 'pending'
    where id = p_staff_id;
  return 'ok';
end $$;
grant execute on function public.claim_account to authenticated;

-- ★ 관리자 비밀번호 리셋 (이메일 없이 운영하므로 분실 시 관리자가 직접 재설정)
--   서버(DB)에서 am_admin()을 강제하므로 일반 사용자는 호출 불가
create or replace function public.admin_reset_password(p_staff_id bigint, p_new_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid;
begin
  if not am_admin() then return 'not_admin'; end if;
  if length(p_new_password) < 6 then return 'too_short'; end if;
  select user_id into v_uid from staff where id = p_staff_id;
  if v_uid is null then return 'no_account'; end if;
  update auth.users
    set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf'))
    where id = v_uid;
  return 'ok';
end $$;
grant execute on function public.admin_reset_password to authenticated;

-- ---------- activities ----------
-- 조회: 본인 파트 전체 / 리더·법인장·관리자는 전 파트 / 참여자 본인
create policy act_select on public.activities for select to authenticated using (
  am_active() and (
    part = my_part()
    or my_role() in ('leader','director')
    or am_admin()
    or exists (select 1 from activity_participants ap
               where ap.activity_id = id and ap.staff_id = my_staff_id())
  )
);
create policy act_insert on public.activities for insert to authenticated
  with check ( am_active() and created_by = my_staff_id() );
create policy act_update on public.activities for update to authenticated
  using ( created_by = my_staff_id() or am_admin() );
create policy act_delete on public.activities for delete to authenticated
  using ( created_by = my_staff_id() or am_admin() );

-- ---------- activity_participants ----------
create policy ap_select on public.activity_participants for select to authenticated
  using ( am_active() );
create policy ap_write on public.activity_participants for insert to authenticated
  with check ( exists(select 1 from activities a
    where a.id = activity_id and a.created_by = my_staff_id()) );
create policy ap_delete on public.activity_participants for delete to authenticated
  using ( exists(select 1 from activities a
    where a.id = activity_id and a.created_by = my_staff_id()) or am_admin() );

-- ---------- reports (면담록) ----------
-- 조회: 작성자 본인 / 같은 파트의 파트리더 / 법인장 / 관리자
-- ※ 타 파트 리더는 못 봄 (요구사항)
create policy rep_select on public.reports for select to authenticated using (
  am_active() and (
    author_id = my_staff_id()
    or (my_role() = 'leader' and part = my_part())
    or my_role() = 'director'
    or am_admin()
  )
);
create policy rep_insert on public.reports for insert to authenticated
  with check ( am_active() and author_id = my_staff_id() );
-- 수정: 작성자(작성중/반송 상태) 또는 리뷰 권한자(상태 변경용)
create policy rep_update on public.reports for update to authenticated using (
  (author_id = my_staff_id())
  or (my_role() = 'leader' and part = my_part())
  or my_role() = 'director'
  or am_admin()
);
create policy rep_delete on public.reports for delete to authenticated
  using ( author_id = my_staff_id() and status = 'draft' );

-- ---------- report_events ----------
create policy re_select on public.report_events for select to authenticated using (
  exists (select 1 from reports r where r.id = report_id) -- reports RLS가 자동 적용됨
);
create policy re_insert on public.report_events for insert to authenticated
  with check ( am_active() and actor_id = my_staff_id() );
-- 삭제/수정 정책 없음 = 아무도 못 지움 (감사 로그)

-- ============================================================
-- 전사 활동 서머리 RPC (타 파트 직원도 "집계"는 볼 수 있음)
-- ============================================================
create or replace function public.activity_stats(p_from date, p_to date)
returns table (staff_id bigint, name text, part text, role text,
               a_type text, hosted bigint, joined bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.part, s.role, t.a_type,
    count(*) filter (where ap.p_role = 'host')        as hosted,
    count(*) filter (where ap.p_role = 'participant') as joined
  from staff s
  cross join (values ('meeting'),('vc'),('trip'),('other')) t(a_type)
  left join activity_participants ap on ap.staff_id = s.id
  left join activities a on a.id = ap.activity_id
    and a.type = t.a_type
    and a.activity_date between p_from and p_to
  where s.status in ('active','pending','disabled')
    and am_active()
  group by s.id, s.name, s.part, s.role, t.a_type;
$$;
grant execute on function public.activity_stats to authenticated;

-- ============================================================
-- 운영 방식: 관리자가 staff에 명단(이름/사번/파트/역할) 사전등록
--   → 직원이 본인 이름 선택 + 사번 대조로 가입 신청 → 관리자 승인.
-- 비밀번호 분실 시: 관리자가 앱의 Admin 화면에서 임시 비밀번호로 리셋.
-- ============================================================
-- ★ 본인(관리자) 부트스트랩: 가입 신청 후 아래 실행 (login_id 본인 것으로)
-- ============================================================
-- update public.staff set is_admin = true, status = 'active'
--   where login_id = 'aiden';
