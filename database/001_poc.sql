-- Fresh POC database only. No platform accounts, tenants, demands or cooperation.
create table if not exists poc_schema(version integer primary key, source_hash text not null, applied_at timestamptz not null default now());
create table sessions (
 id uuid primary key, token_hash text not null unique, csrf text not null,
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table runs (
 id uuid primary key, session_id uuid not null references sessions(id), input_id uuid not null,
 client_key uuid not null, input_text text not null check(length(input_text) between 1 and 20000),
 input_at timestamptz not null, state text not null check(state in ('pending','running','done','failed','cancelled')),
 revision integer not null default 0, snapshot jsonb, failure text, final_message_id uuid,
 created_at timestamptz not null default now(), unique(session_id,id), unique(session_id,client_key)
);
create unique index one_active_run on runs(session_id) where state in ('pending','running');
create table messages (
 id uuid primary key, session_id uuid not null references sessions(id), run_id uuid not null,
 ordinal bigint generated always as identity unique, author text not null check(author in ('user','assistant')),
 text text not null check(octet_length(text)<=262144), delivery text check(delivery in ('intermediate','final')),
 message_key text not null, unique(session_id,id),
 foreign key(session_id,run_id) references runs(session_id,id) deferrable initially deferred
);
alter table runs add foreign key(session_id,input_id) references messages(session_id,id) deferrable initially deferred;
alter table runs add foreign key(session_id,final_message_id) references messages(session_id,id) deferrable initially deferred;
create table native_entries (
 session_id uuid not null references sessions(id), sequence integer not null, entry_id text not null,
 parent_entry_id text, mapping_id uuid not null, entry jsonb not null check(octet_length(entry::text)<=262144),
 primary key(session_id,entry_id), unique(session_id,sequence)
);
create table documents (
 id uuid primary key, session_id uuid not null references sessions(id), request_key uuid not null,
 file_name text not null, format text not null check(format in ('txt','md','docx','pdf')),
 declared_bytes integer not null check(declared_bytes between 1 and 20971520), stored_bytes integer,
 state text not null, created_at timestamptz not null default now(), unique(session_id,id),unique(session_id,request_key)
);
create table document_sources (
 id uuid primary key, session_id uuid not null, document_id uuid not null,
 kind text not null check(kind in ('original','supplement')), request_key uuid not null,
 view jsonb not null, markdown text not null default '' check(length(markdown)<=100000),
 foreign key(session_id,document_id) references documents(session_id,id), unique(session_id,id), unique(session_id,document_id,id), unique(document_id,request_key)
);
create table document_segments (
 id uuid primary key, session_id uuid not null, document_id uuid not null, source_id uuid not null,
 ordinal integer not null, title text not null, summary text not null, location jsonb not null, text text not null,
 foreign key(session_id,document_id) references documents(session_id,id),
 foreign key(session_id,document_id,source_id) references document_sources(session_id,document_id,id), unique(source_id,ordinal)
);
create table payments (
 id uuid primary key, session_id uuid not null references sessions(id), document_message_id uuid not null,
 prepare_key uuid not null, revision integer not null, record jsonb not null,
 created_at timestamptz not null default now(), unique(session_id,prepare_key),
 foreign key(session_id,document_message_id) references messages(session_id,id)
);
create function payment_immutable() returns trigger language plpgsql as $$
begin
 if new.session_id<>old.session_id or new.document_message_id<>old.document_message_id or new.prepare_key<>old.prepare_key
 or (new.record - array['revision','state','paymentConsentAt','orderId','orderStatus','captureId','captureStatus','refundId','refundStatus','attemptedAt','pending','outcome','failureCode','updatedAt'])
 is distinct from (old.record - array['revision','state','paymentConsentAt','orderId','orderStatus','captureId','captureStatus','refundId','refundStatus','attemptedAt','pending','outcome','failureCode','updatedAt'])
 or new.revision<>old.revision+1 or (new.record->>'revision')::integer<>new.revision
 then raise exception 'immutable payment snapshot or revision';end if;
 if (old.record->>'orderId' is not null and new.record->>'orderId' is distinct from old.record->>'orderId')
 or (old.record->>'captureId' is not null and new.record->>'captureId' is distinct from old.record->>'captureId')
 or (old.record->>'refundId' is not null and new.record->>'refundId' is distinct from old.record->>'refundId')
 then raise exception 'immutable provider receipt';end if;
 return new;
end $$;
create trigger payment_guard before update on payments for each row execute function payment_immutable();
create table trace_events (
 id uuid primary key, run_id uuid not null references runs(id), sequence bigint generated always as identity,
 at timestamptz not null, recorded_at timestamptz not null default now(), type text not null,
 data jsonb not null check(octet_length(data::text)<=4194304),unique(run_id,sequence)
);
-- The initializer records this SQL file hash in the ledger in the same transaction.
