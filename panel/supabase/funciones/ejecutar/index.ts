// Función «ejecutar» de Supabase: el botón Publicar / Volver del Panel.
//
// 1. Comprueba que quien llama es administradora con contraseña + código del
//    móvil (la misma regla es_admin() de la base de datos).
// 2. Valida la orden (aprobar o volver, promoción existente, versión, motivo).
// 3. Pide a GitHub que arranque el proceso .github/workflows/publicar.yml del
//    taller, con la llave A (secreto GITHUB_EJECUTOR, que solo permite arrancar
//    procesos del taller). La llave nunca sale de aquí.
// 4. Lo anota en el registro de actividad.
//
// Publicar exige que la promotora haya aprobado todos los planos de esa versión
// (011_planos.sql). Las versiones preparadas antes de existir los planos (sin
// planos.json en la vista previa) se pueden publicar como hasta ahora.
//
// Se pega en Supabase → Edge Functions con el nombre «ejecutar».

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const ORIGENES = ['https://panel.mune-projects.workers.dev', 'https://revision-panel.mune-projects.workers.dev'];
const PROCESO = 'https://api.github.com/repos/MUNE-Projects/taller/actions/workflows/publicar.yml/dispatches';
const REVISION = Deno.env.get('REVISION_ESCAPARATE') ?? 'https://revision-escaparate.mune-projects.workers.dev';
const NO_LISTOS: Record<string, string> = {
	sin_enviar: 'Primero envía los planos a la promotora para que los valide.',
	pendientes: 'Faltan planos por aprobar por la promotora.',
	cambios: 'La promotora ha pedido cambios en algún plano.',
};

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
	const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
		global: { headers: { Authorization: auth } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const { data: esAdmin, error: eAdmin } = await sb.rpc('es_admin');
	if (eAdmin || esAdmin !== true) {
		return responder(403, { error: 'Solo la administradora, con el código del móvil, puede publicar.' });
	}

	let cuerpo: Record<string, unknown>;
	try {
		cuerpo = await req.json();
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const accion = String(cuerpo.accion ?? '');
	const promocion = String(cuerpo.promocion ?? '');
	const version = String(cuerpo.version ?? '');
	const motivo = String(cuerpo.motivo ?? '').trim();
	if (accion !== 'aprobar' && accion !== 'volver') return responder(400, { error: 'Acción no válida' });
	if (!/^[a-z0-9-]{1,60}$/.test(promocion)) return responder(400, { error: 'Promoción no válida' });
	// «aprobar»: la versión revisada en la vista previa (el ejecutor comprueba que sigue siendo esa)
	if (!/^v[0-9]{1,5}$/.test(version)) return responder(400, { error: 'Versión no válida' });
	if (accion === 'volver' && (motivo.length < 3 || motivo.length > 500)) {
		return responder(400, { error: 'Indica el motivo (entre 3 y 500 caracteres)' });
	}

	const { data: promo } = await sb.from('promociones').select('id').eq('id', promocion).maybeSingle();
	if (!promo) return responder(404, { error: 'No existe esa promoción' });
	if (accion === 'aprobar') {
		const { data: listos, error: eListos } = await sb.rpc('planos_listos', { p_promocion: promocion, p_version: version });
		if (eListos) return responder(500, { error: 'No se ha podido comprobar los planos' });
		if (listos !== 'listos') {
			// sin planos enviados: solo se permite si la versión no generó planos (preparada antes de la Etapa 4)
			const r = listos === 'sin_enviar' ? await fetch(`${REVISION}/${promocion}/planos/planos.json`, { cache: 'no-store' }).catch(() => null) : null;
			if (r?.status !== 404) return responder(409, { error: `No se puede publicar ${version}: ${NO_LISTOS[listos] ?? 'los planos no están aprobados.'}` });
		}
	}
	const { data: admin } = await sb.from('administradores').select('nombre').maybeSingle();

	const llave = Deno.env.get('GITHUB_EJECUTOR');
	if (!llave) return responder(500, { error: 'Falta la llave A (GITHUB_EJECUTOR) en los secretos de Supabase' });

	const solicitud = crypto.randomUUID();
	const r = await fetch(PROCESO, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${llave}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'mune-panel',
		},
		body: JSON.stringify({
			ref: 'main',
			inputs: { accion, promocion, version, motivo, por: admin?.nombre ?? 'Administradora', solicitud },
		}),
	});
	if (!r.ok) {
		const detalle = (await r.text()).slice(0, 200);
		return responder(502, { error: `GitHub no ha aceptado la orden (${r.status}). ${detalle}` });
	}

	await sb.from('registro').insert({
		accion: accion === 'aprobar' ? 'publica desde el Panel' : 'vuelve a una versión anterior',
		detalle: { promocion, version, motivo: motivo || null, solicitud },
	});
	return responder(202, { ok: true, solicitud });
});
