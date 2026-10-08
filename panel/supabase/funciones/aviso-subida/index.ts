// Función «aviso-subida» de Supabase: aviso por email a la administradora cada
// vez que una promotora sube un documento (Etapa 3).
//
// 1. La llama el portal justo después de subir el documento, con la sesión de
//    quien lo ha subido.
// 2. marcar_aviso_subida (009) comprueba que lo subió esa persona hace menos de
//    30 minutos y que no se ha avisado ya: cada documento avisa una sola vez.
// 3. Pide a GitHub que arranque .github/workflows/aviso-documento.yml del
//    taller, con la llave A (secreto GITHUB_EJECUTOR, la misma del botón
//    Publicar, que solo permite arrancar procesos del taller). GitHub envía el
//    email, igual que el aviso «versión lista para revisar».
//
// Las funciones de Supabase no pueden enviar email por SMTP (Gmail), por eso
// el email lo manda GitHub. No usa la clave de servicio.
//
// Se pega en Supabase → Edge Functions con el nombre «aviso-subida».

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const PROCESO = 'https://api.github.com/repos/MUNE-Projects/taller/actions/workflows/aviso-documento.yml/dispatches';
const ORIGENES = [
	'https://portal.mune-projects.workers.dev',
	'https://revision-portal.mune-projects.workers.dev',
	// Solo en el Supabase local de las pruebas: el portal en el ordenador de desarrollo.
	...(Deno.env.get('ORIGENES_EXTRA')?.split(',') ?? []),
];

const corto = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

Deno.serve(async (req) => {
	const origen = req.headers.get('origin') ?? '';
	const cors: Record<string, string> = {
		'Access-Control-Allow-Origin': ORIGENES.includes(origen) ? origen : ORIGENES[0],
		'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		Vary: 'Origin',
	};
	const responder = (estado: number, datos: Record<string, unknown>) =>
		new Response(JSON.stringify(datos), { status: estado, headers: { ...cors, 'Content-Type': 'application/json' } });

	if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
	if (req.method !== 'POST') return responder(405, { error: 'Método no permitido' });

	const auth = req.headers.get('authorization');
	if (!auth?.startsWith('Bearer ')) return responder(401, { error: 'Sin sesión' });
	const sb = createClient(SUPABASE_URL, CLAVE_PUBLICA, {
		global: { headers: { Authorization: auth } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	let documento: number;
	try {
		documento = Number((await req.json()).documento_id);
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	if (!Number.isInteger(documento) || documento <= 0) return responder(400, { error: 'Documento no válido' });

	const { data: toca, error: eMarca } = await sb.rpc('marcar_aviso_subida', { p_documento: documento });
	if (eMarca) return responder(403, { error: 'Sin permiso' });
	if (toca !== true) return responder(200, { ok: true, avisado: false });

	const { data: d } = await sb.from('documentos')
		.select('nombre, version, promocion_id, requisitos(elemento), promociones(nombre, promotoras(nombre))')
		.eq('id', documento).maybeSingle();
	const { data: { user } } = await sb.auth.getUser();
	const { data: persona } = await sb.from('miembros').select('nombre').eq('user_id', user?.id ?? '').limit(1).maybeSingle();
	if (!d) return responder(404, { error: 'No se encuentra el documento' });
	const fila = d as unknown as {
		nombre: string; version: number; promocion_id: string;
		requisitos: { elemento: string } | null; promociones: { nombre: string; promotoras: { nombre: string } | null } | null;
	};

	const llave = Deno.env.get('GITHUB_EJECUTOR');
	if (!llave) return responder(500, { error: 'Falta la llave A (GITHUB_EJECUTOR) en los secretos de Supabase' });
	const r = await fetch(PROCESO, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${llave}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'mune-portal',
		},
		body: JSON.stringify({
			ref: 'main',
			inputs: {
				promocion: fila.promocion_id,
				nombre: corto(fila.promociones?.nombre, 120),
				promotora: corto(fila.promociones?.promotoras?.nombre, 120),
				documento: corto(fila.requisitos?.elemento, 120),
				archivo: corto(fila.nombre, 200),
				version: String(fila.version),
				persona: corto(persona?.nombre, 120),
			},
		}),
	});
	if (!r.ok) return responder(502, { error: `GitHub no ha aceptado el aviso (${r.status})` });
	return responder(200, { ok: true, avisado: true });
});
