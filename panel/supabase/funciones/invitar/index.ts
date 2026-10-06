// Función «invitar» de Supabase: dar acceso al portal a una persona de una
// promotora (receta 14), desde la sección Promotoras del Panel.
//
// 1. Comprueba que quien llama es administradora con contraseña + código del
//    móvil (la misma regla es_admin() de la base de datos).
// 2. «invitar»: si el correo no tiene cuenta, la crea y Supabase le envía el
//    email de invitación con el enlace para elegir su contraseña en el portal.
//    Después le da acceso a la promotora, con su rol, usando la sesión de la
//    administradora (así lo comprueban las reglas y queda en el registro).
//    «reenviar»: vuelve a enviar la invitación o, si ya la aceptó, un enlace
//    para cambiar la contraseña.
//
// Para crear cuentas hace falta la clave de servicio de Supabase. Supabase se
// la da a la función automáticamente y no sale nunca de sus servidores: no
// está en el Panel, ni en GitHub, ni se copia a ningún sitio. La función solo
// la usa para crear la cuenta y enviar el email; nada más.
//
// Se pega en Supabase → Edge Functions con el nombre «invitar».

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const PORTAL = Deno.env.get('PORTAL_URL') ?? 'https://portal.mune-projects.workers.dev/';
const ORIGENES = [
	'https://panel.mune-projects.workers.dev',
	'https://revision-panel.mune-projects.workers.dev',
	// Solo en el Supabase local de las pruebas: el Panel en el ordenador de desarrollo.
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

	const { data: esAdmin, error: eAdmin } = await sb.rpc('es_admin');
	if (eAdmin || esAdmin !== true) {
		return responder(403, { error: 'Solo la administradora, con el código del móvil, puede dar accesos.' });
	}

	const clave = claveServicio();
	if (!clave) return responder(500, { error: 'Supabase no ha dado a la función su clave de servicio' });
	const servicio = createClient(SUPABASE_URL, clave, { auth: sinSesion });

	let cuerpo: Record<string, unknown>;
	try {
		cuerpo = await req.json();
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const accion = String(cuerpo.accion ?? '');
	const promotora = String(cuerpo.promotora_id ?? '');
	if (!/^[0-9a-f-]{36}$/.test(promotora)) return responder(400, { error: 'Promotora no válida' });

	const { data: po } = await sb.from('promotoras').select('id, nombre, activa').eq('id', promotora).maybeSingle();
	if (!po) return responder(404, { error: 'No existe esa promotora' });

	if (accion === 'invitar') {
		const nombre = String(cuerpo.nombre ?? '').trim();
		const email = String(cuerpo.email ?? '').trim().toLowerCase();
		const rol = String(cuerpo.rol ?? '');
		if (nombre.length < 2 || nombre.length > 120) return responder(400, { error: 'Escribe el nombre de la persona' });
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return responder(400, { error: 'El correo no es válido' });
		if (rol !== 'gestor' && rol !== 'aprobador') return responder(400, { error: 'Rol no válido' });
		if (!po.activa) return responder(409, { error: 'La promotora está desactivada. Actívala antes de dar accesos.' });

		const { data: cuentas, error: eCuenta } = await servicio.rpc('cuenta_por_email', { p_email: email });
		if (eCuenta) return responder(500, { error: `No se ha podido comprobar el correo: ${eCuenta.message}` });
		const cuenta = (cuentas as { user_id: string; confirmada: boolean; interna: boolean }[] | null)?.[0];
		if (cuenta?.interna) return responder(409, { error: 'Ese correo es de una cuenta interna (administración o robot).' });

		let userId = cuenta?.user_id;
		let enviada = false;
		if (!userId) {
			const { data, error } = await servicio.auth.admin.inviteUserByEmail(email, { redirectTo: PORTAL, data: { nombre } });
			if (error) return responder(502, { error: `No se ha podido enviar la invitación: ${error.message}` });
			userId = data.user.id;
			enviada = true;
		}

		const { error: eMiembro } = await sb.from('miembros').insert({ user_id: userId, promotora_id: promotora, nombre, email, rol });
		if (eMiembro) {
			if (eMiembro.code === '23505') return responder(409, { error: 'Esa persona ya tiene acceso a esta promotora (o lo tuvo: usa «Devolver acceso»).' });
			return responder(500, { error: `No se ha podido dar el acceso: ${eMiembro.message}` });
		}
		await sb.from('registro').insert({ accion: 'da acceso al portal', detalle: { promotora, email, rol, invitacion: enviada } });
		return responder(200, {
			ok: true,
			mensaje: enviada
				? `Invitación enviada a ${email}. Le llegará un email para elegir su contraseña.`
				: `${email} ya tenía cuenta: puede entrar al portal con su contraseña de siempre.`,
		});
	}

	if (accion === 'reenviar') {
		const userId = String(cuerpo.user_id ?? '');
		const { data: m } = await sb.from('miembros').select('email, activo')
			.eq('promotora_id', promotora).eq('user_id', userId).maybeSingle();
		if (!m) return responder(404, { error: 'Esa persona no tiene acceso a esta promotora' });
		if (!m.activo) return responder(409, { error: 'Su acceso está retirado. Devuélveselo antes de reenviar.' });

		const { data: u, error: eU } = await servicio.auth.admin.getUserById(userId);
		if (eU || !u.user) return responder(404, { error: 'No se encuentra la cuenta' });
		const email = u.user.email!;
		const { error } = u.user.email_confirmed_at
			? await createClient(SUPABASE_URL, CLAVE_PUBLICA, { auth: sinSesion }).auth.resetPasswordForEmail(email, { redirectTo: PORTAL })
			: await servicio.auth.admin.inviteUserByEmail(email, { redirectTo: PORTAL });
		if (error) return responder(502, { error: `No se ha podido enviar: ${error.message}` });
		await sb.from('registro').insert({ accion: 'reenvía acceso al portal', detalle: { promotora, email } });
		return responder(200, {
			ok: true,
			mensaje: u.user.email_confirmed_at
				? `Enviado a ${email} un enlace para elegir una contraseña nueva.`
				: `Invitación reenviada a ${email}.`,
		});
	}

	return responder(400, { error: 'Acción no válida' });
});
