-- Aviso por Telegram cuando un chofer pide carga.
--
-- El circuito de aprobación dejó al chofer esperando a que alguien mire el
-- panel. Nadie mira un panel todo el día, así que el aviso tiene que ir a
-- donde la gente ya está. Telegram es gratis y no pide nada más que un bot.
--
-- Va en la base y no en la app a propósito: el aviso se dispara por la fila,
-- no por la pantalla que la creó. Si mañana se registra una solicitud desde
-- otro lado —el panel, una importación, otra app— el aviso sale igual, y no
-- hay que volver a compilar el APK para cambiar el texto.
--
-- El token del bot vive en Vault (cifrado), no en esta tabla ni en el
-- navegador. El panel lo escribe por una función y nunca lo puede leer de
-- vuelta: se ve si está configurado, no cuál es.

create extension if not exists pg_net;

create table public.notificaciones_telegram (
  empresa_id          uuid primary key references public.empresas (id) on delete cascade,

  -- Puede ser un grupo (negativo) o una persona. Se detecta desde el panel.
  chat_id             text not null,
  activo              boolean not null default true,

  -- Qué se avisa. Por ahora sólo las solicitudes; la función de envío es
  -- genérica, así que sumar otro evento es una columna y un trigger.
  avisar_solicitudes  boolean not null default true,

  -- A dónde mandar a quien recibe el aviso.
  url_panel           text not null default 'https://verd-chofe-faea.vercel.app/admin/solicitudes',

  configurado_por     uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger tg_notificaciones_telegram_updated_at
  before update on public.notificaciones_telegram
  for each row execute function public.set_updated_at();

alter table public.notificaciones_telegram enable row level security;

-- Sin token adentro, la configuración es inocua: el admin de la empresa la ve
-- y la puede apagar. Escribirla va igual por la función, porque el token
-- viaja en la misma operación.
create policy notificaciones_telegram_admin on public.notificaciones_telegram
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- =====================================================================
-- Piezas internas
-- =====================================================================
-- Telegram interpreta HTML en el mensaje. Un nombre con "&" o "<" rompería
-- el envío entero, así que se escapa antes de armar el texto.
create or replace function public.telegram_escapar(p_texto text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(p_texto, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

revoke all on function public.telegram_escapar(text) from public, anon, authenticated;

/** El token de la empresa, descifrado. Nadie fuera de la base lo llama. */
create or replace function public.telegram_token(p_empresa uuid)
returns text
language sql stable security definer set search_path = public, vault
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = 'telegram_bot_token:' || p_empresa::text
  limit 1;
$$;

revoke all on function public.telegram_token(uuid) from public, anon, authenticated;

/**
 * Manda un mensaje al chat de la empresa. Devuelve el id de la petición de
 * pg_net, que es asincrónica: acá sólo se encola, la respuesta de Telegram
 * llega después a `net._http_response`.
 *
 * Silencioso a propósito cuando no hay nada configurado: el aviso es un
 * extra, no una condición para que el sistema funcione.
 */
create or replace function public.telegram_enviar(p_empresa uuid, p_texto text)
returns bigint
language plpgsql security definer set search_path = public, net
as $$
declare
  v_cfg   public.notificaciones_telegram%rowtype;
  v_token text;
  v_id    bigint;
begin
  select * into v_cfg from public.notificaciones_telegram where empresa_id = p_empresa;
  if v_cfg.empresa_id is null or not v_cfg.activo then return null; end if;

  v_token := public.telegram_token(p_empresa);
  if v_token is null or length(trim(v_token)) = 0 then return null; end if;

  select net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body := jsonb_build_object(
      'chat_id', v_cfg.chat_id,
      'text', p_texto,
      'parse_mode', 'HTML',
      'disable_web_page_preview', true
    ),
    timeout_milliseconds := 8000
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function public.telegram_enviar(uuid, text) from public, anon, authenticated;

-- =====================================================================
-- El aviso de la solicitud
-- =====================================================================
create or replace function public.avisar_solicitud_por_telegram()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_chofer text;
  v_unidad text;
  v_url    text;
  v_texto  text;
begin
  if not exists (
    select 1 from public.notificaciones_telegram n
    where n.empresa_id = new.empresa_id and n.activo and n.avisar_solicitudes
  ) then
    return new;
  end if;

  select c.nombre into v_chofer from public.choferes c where c.id = new.chofer_id;
  select coalesce(u.alias, u.placa) into v_unidad from public.unidades u where u.id = new.unidad_id;
  select n.url_panel into v_url from public.notificaciones_telegram n where n.empresa_id = new.empresa_id;

  v_texto :=
    '⛽ <b>Solicitud de carga</b>' || E'\n' ||
    '👤 ' || public.telegram_escapar(coalesce(v_chofer, 'Chofer')) || E'\n' ||
    '🚚 ' || public.telegram_escapar(coalesce(v_unidad, 'sin unidad')) || E'\n' ||
    '💧 ' || coalesce(trim(to_char(new.litros, 'FM999990.00')) || ' litros', 'sin cantidad') ||
      coalesce(' · ≈ $' || trim(to_char(new.monto_estimado, 'FM999999990.00')), '') || E'\n' ||
    coalesce('⛽ ' || public.telegram_escapar(new.estacion) || E'\n', '') ||
    coalesce('📝 ' || public.telegram_escapar(new.motivo) || E'\n', '') ||
    E'\n' || 'Autorizá acá: ' || coalesce(v_url, '');

  perform public.telegram_enviar(new.empresa_id, v_texto);
  return new;

-- Un aviso que falla no puede tumbar la solicitud: el chofer quedaría sin
-- poder pedir por un problema que no es suyo ni tiene cómo resolver.
exception when others then
  raise warning 'Aviso de Telegram no enviado: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.avisar_solicitud_por_telegram() from public, anon, authenticated;

create trigger tg_solicitudes_avisan_por_telegram
  after insert on public.solicitudes_combustible
  for each row execute function public.avisar_solicitud_por_telegram();

-- =====================================================================
-- Lo que usa el panel
-- =====================================================================
create or replace function public.telegram_admin_check(p_empresa uuid)
returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if not (select public.es_admin()) or p_empresa not in (select public.empresa_ids_actual()) then
    raise exception 'Sólo un administrador de la empresa puede configurar los avisos';
  end if;
end;
$$;

revoke all on function public.telegram_admin_check(uuid) from public, anon, authenticated;

/**
 * Guarda la configuración. El token se escribe en Vault y no vuelve a salir
 * de ahí; mandar `null` o vacío deja el que ya estaba, para poder cambiar
 * sólo el chat sin tener que volver a pegar el token.
 */
create or replace function public.telegram_guardar(
  p_empresa uuid,
  p_chat_id text,
  p_token   text default null,
  p_activo  boolean default true
)
returns void
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_nombre text := 'telegram_bot_token:' || p_empresa::text;
  v_id     uuid;
begin
  perform public.telegram_admin_check(p_empresa);

  if p_token is not null and length(trim(p_token)) > 0 then
    select id into v_id from vault.secrets where name = v_nombre;
    if v_id is null then
      perform vault.create_secret(trim(p_token), v_nombre, 'Bot de Telegram para avisos de choferes');
    else
      perform vault.update_secret(v_id, trim(p_token));
    end if;
  end if;

  insert into public.notificaciones_telegram (empresa_id, chat_id, activo, configurado_por)
  values (p_empresa, trim(p_chat_id), coalesce(p_activo, true), (select auth.uid()))
  on conflict (empresa_id) do update
    set chat_id = excluded.chat_id,
        activo = excluded.activo,
        configurado_por = excluded.configurado_por,
        updated_at = now();
end;
$$;

grant execute on function public.telegram_guardar(uuid, text, text, boolean) to authenticated;

/** Si está configurado y con qué chat. El token nunca se devuelve. */
create or replace function public.telegram_estado(p_empresa uuid)
returns table (con_token boolean, chat_id text, activo boolean, url_panel text)
language plpgsql stable security definer set search_path = public, vault
as $$
begin
  perform public.telegram_admin_check(p_empresa);

  return query
  select
    exists (select 1 from vault.secrets s where s.name = 'telegram_bot_token:' || p_empresa::text),
    n.chat_id, n.activo, n.url_panel
  from public.notificaciones_telegram n
  where n.empresa_id = p_empresa;

  if not found then
    return query select
      exists (select 1 from vault.secrets s where s.name = 'telegram_bot_token:' || p_empresa::text),
      null::text, false, null::text;
  end if;
end;
$$;

grant execute on function public.telegram_estado(uuid) to authenticated;

/** Manda un mensaje de prueba al chat configurado. */
create or replace function public.telegram_probar(p_empresa uuid)
returns bigint
language plpgsql security definer set search_path = public
as $$
begin
  perform public.telegram_admin_check(p_empresa);
  return public.telegram_enviar(
    p_empresa,
    '✅ <b>Prueba de avisos</b>' || E'\n' ||
    'Si ves esto, las solicitudes de carga van a llegar por acá.'
  );
end;
$$;

grant execute on function public.telegram_probar(uuid) to authenticated;

/**
 * Pregunta a Telegram qué chats le escribieron al bot. Es la forma de sacar
 * el chat_id sin que nadie tenga que pegar el token en la barra del
 * navegador —que lo dejaría en el historial y en cualquier proxy del camino.
 */
create or replace function public.telegram_detectar_chats(p_empresa uuid)
returns bigint
language plpgsql security definer set search_path = public, net
as $$
declare
  v_token text;
  v_id    bigint;
begin
  perform public.telegram_admin_check(p_empresa);

  v_token := public.telegram_token(p_empresa);
  if v_token is null then
    raise exception 'Primero guardá el token del bot';
  end if;

  select net.http_get(
    url := 'https://api.telegram.org/bot' || v_token || '/getUpdates',
    timeout_milliseconds := 8000
  ) into v_id;

  return v_id;
end;
$$;

grant execute on function public.telegram_detectar_chats(uuid) to authenticated;

/**
 * La respuesta de una petición de pg_net. Como es asincrónica, el panel
 * pregunta por el id hasta que aparece.
 */
create or replace function public.telegram_respuesta(p_id bigint)
returns table (listo boolean, status_code integer, contenido text, error text)
language plpgsql security definer set search_path = public, net
as $$
begin
  if not (select public.es_admin()) then
    raise exception 'Sólo un administrador puede consultar esto';
  end if;

  return query
  select true, r.status_code, left(r.content, 4000), r.error_msg
  from net._http_response r
  where r.id = p_id;

  if not found then
    return query select false, null::integer, null::text, null::text;
  end if;
end;
$$;

grant execute on function public.telegram_respuesta(bigint) to authenticated;

comment on table public.notificaciones_telegram is
  'A qué chat de Telegram avisar. El token del bot NO está acá: vive cifrado en Vault.';

-- `create function` concede EXECUTE a PUBLIC por omisión, así que el rol
-- `anon` —el de quien no inició sesión— quedaba pudiendo llamar estas
-- funciones. Todas verifican `es_admin()` adentro y le responderían con una
-- excepción, pero la verificación no debería ser lo único que separa a un
-- anónimo de la configuración de avisos: si mañana alguien toca ese chequeo,
-- la puerta ya estaría abierta.
revoke all on function public.telegram_guardar(uuid, text, text, boolean) from public, anon;
revoke all on function public.telegram_estado(uuid) from public, anon;
revoke all on function public.telegram_probar(uuid) from public, anon;
revoke all on function public.telegram_detectar_chats(uuid) from public, anon;
revoke all on function public.telegram_respuesta(bigint) from public, anon;

grant execute on function public.telegram_guardar(uuid, text, text, boolean) to authenticated;
grant execute on function public.telegram_estado(uuid) to authenticated;
grant execute on function public.telegram_probar(uuid) to authenticated;
grant execute on function public.telegram_detectar_chats(uuid) to authenticated;
grant execute on function public.telegram_respuesta(bigint) to authenticated;
