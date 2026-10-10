// Función «avisar-promotora» de Supabase: email al equipo de una promoción.
//
//   { tipo: 'planos', promocion, version }    planos nuevos para validar (Panel)
//   { tipo: 'publicada', promocion, version } versión publicada (Panel)
//   { tipo: 'rechazado', documento_id }       documento rechazado, con su nota
//                                             (Panel o robot de Claude)
//
// 1. Comprueba quién llama: la administradora (con el código del móvil) o, solo
//    para «rechazado», el robot de Claude.
// 2. Comprueba que lo que se avisa es cierto (hay planos de esa versión, la web
//    ya está en esa versión, el documento está rechazado) y que no se avisó ya.
// 3. Busca los correos del equipo (acceso a esa promoción o a todas) con la
//    clave de servicio, que Supabase da a la función y no sale de aquí: quien
//    llama nunca ve los correos.
// 4. Pide a GitHub que arranque .github/workflows/aviso-promotora.yml, que
//    envía el email desde el Gmail de MUNE (contraseña de aplicación guardada
//    como secreto AVISOS_GMAIL_CLAVE en GitHub). Sin coste.
//
// Se pega en Supabase → Edge Functions con el nombre «avisar-promotora».

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const PORTAL = Deno.env.get('PORTAL_URL') ?? 'https://portal.mune-projects.workers.dev/';
const ESCAPARATE = Deno.env.get('ESCAPARATE_URL') ?? 'https://escaparate.mune-projects.workers.dev';
const PROCESO = 'https://api.github.com/repos/MUNE-Projects/taller/actions/workflows/aviso-promotora.yml/dispatches';
const ORIGENES = [
	'https://panel.mune-projects.workers.dev',
	'https://revision-panel.mune-projects.workers.dev',
	...(Deno.env.get('ORIGENES_EXTRA')?.split(',') ?? []),
];

function claveServicio(): string | undefined {
	const legado = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (legado) return legado;
	try {
		const claves = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
		return claves.default ?? Object.values(claves)[0];
	} catch {
		return undefined;
	}
}

const sinSesion = { persistSession: false, autoRefreshToken: false };

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
	const sb = createClient(SUPABASE_URL, CLAVE_PUBLICA, { global: { headers: { Authorization: auth } }, auth: sinSesion });

	let cuerpo: Record<string, unknown>;
	try {
		cuerpo = await req.json();
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const tipo = String(cuerpo.tipo ?? '');
	if (!['planos', 'publicada', 'rechazado'].includes(tipo)) return responder(400, { error: 'Tipo de aviso no válido' });

	const [{ data: esAdmin }, { data: esRobot }] = await Promise.all([sb.rpc('es_admin'), sb.rpc('es_robot')]);
	if (esAdmin !== true && !(tipo === 'rechazado' && esRobot === true)) return responder(403, { error: 'Sin permiso' });

	const clave = claveServicio();
	if (!clave) return responder(500, { error: 'Falta la clave de servicio de Supabase' });
	const servicio = createClient(SUPABASE_URL, clave, { auth: sinSesion });

	// ── Qué se avisa ──
	let promocion = String(cuerpo.promocion ?? '');
	const version = String(cuerpo.version ?? '');
	let claveAviso = '';
	let asunto = '';
	let texto = '';
	let enlace = '';
	const { data: doc } = tipo === 'rechazado'
		? await servicio.from('documentos').select('id, promocion_id, estado, nota, version, nombre, requisitos(elemento)').eq('id', Number(cuerpo.documento_id)).maybeSingle()
		: { data: null };
	if (tipo === 'rechazado') {
		if (!doc || doc.estado !== 'rechazado') return responder(409, { error: 'Ese documento no está rechazado' });
		promocion = doc.promocion_id;
	}
	if (!/^[a-z0-9-]{1,60}$/.test(promocion)) return responder(400, { error: 'Promoción no válida' });
	const { data: promo } = await servicio.from('promociones').select('id, nombre, activa, promotora_id, promotoras(activa)').eq('id', promocion).maybeSingle();
	if (!promo) return responder(404, { error: 'No existe esa promoción' });
	const activa = promo.activa && (promo.promotoras as unknown as { activa: boolean } | null)?.activa;
	if (!activa) return responder(200, { ok: true, enviado: false, motivo: 'La promoción o la promotora está desactivada' });

	if (tipo === 'planos' || tipo === 'publicada') {
		if (!/^v[0-9]{1,5}$/.test(version)) return responder(400, { error: 'Versión no válida' });
		claveAviso = `${promocion}/${version}`;
	}
	if (tipo === 'planos') {
		const { count } = await servicio.from('entregables').select('id', { count: 'exact', head: true })
			.eq('promocion_id', promocion).eq('version', version).eq('tipo', 'plano');
		if (!count) return responder(409, { error: 'Esa versión no tiene planos enviados' });
		asunto = `${promo.nombre} · planos para validar (versión ${version.slice(1)})`;
		texto = `MUNE ha preparado los planos comerciales de la versión ${version.slice(1)} de ${promo.nombre}.\n\n`
			+ `Tenéis ${count} plano${count === 1 ? '' : 's'} para revisar en el portal. En cada uno podéis aprobarlo o pedir cambios explicando qué hay que corregir. La versión se publicará cuando estén todos aprobados.`;
		enlace = `${PORTAL}#/promocion/${promocion}/planos`;
	}
	if (tipo === 'publicada') {
		const r = await fetch(`${ESCAPARATE}/${promocion}/version.json`, { cache: 'no-store' }).catch(() => null);
		const publicada = r?.ok ? (await r.json().catch(() => null))?.version : null;
		if (publicada !== version) return responder(409, { error: 'La web todavía no está en esa versión' });
		asunto = `${promo.nombre} · versión ${version.slice(1)} publicada`;
		texto = `La versión ${version.slice(1)} de ${promo.nombre} ya está publicada en la web.`;
		enlace = `${ESCAPARATE}/${promocion}/`;
	}
	if (tipo === 'rechazado') {
		const elemento = (doc!.requisitos as unknown as { elemento: string } | null)?.elemento ?? 'un documento';
		claveAviso = `documento/${doc!.id}`;
		asunto = `${promo.nombre} · documento por corregir: ${elemento}`;
		texto = `Hemos revisado «${doc!.nombre}» (${elemento}, versión ${doc!.version}) de ${promo.nombre} y hay que corregirlo:\n\n«${doc!.nota ?? ''}»\n\n`
			+ 'Podéis subir una versión nueva desde el portal, en la pestaña Documentación.';
		enlace = `${PORTAL}#/promocion/${promocion}/documentacion`;
	}

	// ── A quién: el equipo de la promoción (con acceso a ella o a todas) ──
	const { data: equipo } = await servicio.from('miembros').select('email')
		.eq('promotora_id', promo.promotora_id).eq('activo', true).or(`promocion_id.is.null,promocion_id.eq.${promocion}`);
	const para = [...new Set((equipo ?? []).map((m) => String(m.email).trim().toLowerCase()).filter((e) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e)))];
	if (!para.length) return responder(200, { ok: true, enviado: false, motivo: 'La promoción no tiene a nadie con acceso' });

	// ── Una sola vez por aviso ──
	const { error: eRepetido } = await servicio.from('avisos_enviados').insert({ tipo, clave: claveAviso, promocion_id: promocion, destinatarios: para.length });
	if (eRepetido) return responder(200, { ok: true, enviado: false, motivo: 'Este aviso ya se había enviado' });

	const llave = Deno.env.get('GITHUB_EJECUTOR');
	const r = llave ? await fetch(PROCESO, {
		method: 'POST',
		headers: { Authorization: `Bearer ${llave}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mune-avisos' },
		body: JSON.stringify({ ref: 'main', inputs: { para: para.join(','), asunto: asunto.slice(0, 200), texto: texto.slice(0, 3000), enlace } }),
	}).catch(() => null) : null;
	if (!r?.ok) {
		// no se ha enviado: se puede volver a intentar
		await servicio.from('avisos_enviados').delete().eq('tipo', tipo).eq('clave', claveAviso);
		return responder(502, { error: llave ? `GitHub no ha aceptado el aviso (${r?.status ?? 'sin respuesta'})` : 'Falta la llave A (GITHUB_EJECUTOR) en los secretos de Supabase' });
	}
	await sb.from('registro').insert({ accion: 'avisa a la promotora por email', detalle: { promocion, tipo, version: version || null, destinatarios: para.length } });
	return responder(200, { ok: true, enviado: true, destinatarios: para.length });
});
