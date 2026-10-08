-- Fase 1 · paso 10: borrar una promoción definitivamente desde el Panel.
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 009. Es repetible.
--
-- Solo la administradora (con el código del móvil), y solo una promoción que
-- ya esté desactivada. Se borra todo lo suyo: documentos y archivos subidos,
-- planos y validaciones, lista de documentos, accesos de su equipo y
-- peticiones de cambios con sus fotos. Las cuentas de las personas no se
-- borran (pueden tener acceso a otras promociones). El registro de actividad
-- se conserva y apunta el borrado.
--
-- Los archivos se borran con la API de almacenamiento (Supabase no permite
-- borrarlos con SQL): el Panel pide la lista con archivos_de_promocion, los
-- borra y después llama a borrar_promocion, que comprueba que no queda
-- ninguno.

-- ¿Es un archivo de una promoción desactivada? (para dejar borrarlo)
--   documentos/<promotora>/<promoción>/…   entregables/<promoción>/…   referencias/<petición>/…
create or replace function public.promocion_del_archivo(p_bucket text, p_nombre text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select case p_bucket
		when 'documentos'  then (storage.foldername(p_nombre))[2]
		when 'entregables' then (storage.foldername(p_nombre))[1]
		when 'referencias' then (select pe.promocion_id from public.peticiones pe
			where pe.id::text = (storage.foldername(p_nombre))[1])
	end;
$$;
revoke all on function public.promocion_del_archivo(text, text) from public, anon;
grant execute on function public.promocion_del_archivo(text, text) to authenticated;

drop policy if exists "admin borra archivos de promociones desactivadas" on storage.objects;
create policy "admin borra archivos de promociones desactivadas" on storage.objects
	for delete to authenticated
	using (bucket_id in ('documentos', 'entregables', 'referencias') and public.es_admin()
		and exists (select 1 from public.promociones pr
			where pr.id = public.promocion_del_archivo(bucket_id, name) and not pr.activa));

-- Archivos guardados de una promoción (para borrarlos o contarlos).
create or replace function public.archivos_de_promocion(p_id text)
returns table (bucket text, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora';
	end if;
	return query
		select o.bucket_id::text, o.name::text from storage.objects o
		where o.bucket_id in ('documentos', 'entregables', 'referencias')
			and public.promocion_del_archivo(o.bucket_id, o.name) = p_id;
end $$;
revoke all on function public.archivos_de_promocion(text) from public, anon;
grant execute on function public.archivos_de_promocion(text) to authenticated;

-- Borra la promoción y todo lo suyo. p_nombre: el nombre escrito a mano como confirmación.
create or replace function public.borrar_promocion(p_id text, p_nombre text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	pr public.promociones%rowtype;
	n_docs int;
	n_peticiones int;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora';
	end if;
	select * into pr from public.promociones where id = p_id;
	if not found then
		raise exception 'Esa promoción no existe';
	end if;
	if pr.activa then
		raise exception 'Primero desactiva la promoción';
	end if;
	if btrim(coalesce(p_nombre, '')) <> btrim(pr.nombre) then
		raise exception 'El nombre escrito no coincide con el de la promoción';
	end if;
	if exists (select 1 from public.archivos_de_promocion(p_id)) then
		raise exception 'Todavía quedan archivos de esta promoción: vuelve a pulsar «Borrar para siempre»';
	end if;

	select count(*) into n_docs from public.documentos where promocion_id = p_id;
	select count(*) into n_peticiones from public.peticiones where promocion_id = p_id;

	delete from public.validaciones where promocion_id = p_id;
	delete from public.entregables  where promocion_id = p_id;
	delete from public.documentos   where promocion_id = p_id;
	delete from public.requisitos   where promocion_id = p_id;
	delete from public.miembros     where promocion_id = p_id;
	delete from public.peticiones   where promocion_id = p_id;
	delete from public.promociones  where id = p_id;

	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'borra una promoción', jsonb_build_object(
		'promocion', p_id, 'nombre', pr.nombre, 'promotora', pr.promotora_id,
		'documentos', n_docs, 'peticiones', n_peticiones));
end $$;
revoke all on function public.borrar_promocion(text, text) from public, anon;
grant execute on function public.borrar_promocion(text, text) to authenticated;

select 'Listo: ya se pueden borrar promociones desde el Panel' as resultado;
