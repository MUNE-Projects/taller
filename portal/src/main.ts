import { createClient } from '@supabase/supabase-js';

// Portal de las promotoras. Cada persona entra con su correo y su contraseña
// (la elige al aceptar la invitación) y solo ve las promociones de su
// promotora: lo comprueban las reglas de la base de datos
// (panel/supabase/005_portal.sql), no esta página.
//
// Datos públicos del proyecto de Supabase: la clave «publishable» está pensada
// para ir en el navegador y por sí sola no da acceso a nada.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = import.meta.env.VITE_SUPABASE_CLAVE ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const ESCAPARATE = 'https://escaparate.mune-projects.workers.dev';

// La sesión vive solo en esta pestaña y caduca tras un rato sin actividad.
const INACTIVIDAD_MAX = 60 * 60 * 1000;
const MAX_TAM = 50 * 1024 * 1024;
const MIN_CLAVE = 10;

// Los enlaces de los emails (invitación o contraseña nueva) llegan con la
// sesión en la dirección. Se mira de qué tipo es antes de que Supabase la lea.
const enlaceEmail = new URLSearchParams(location.hash.slice(1));
const tipoEnlace = enlaceEmail.get('type');
const errorEnlace = enlaceEmail.get('error_description');

const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
	auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const app = document.getElementById('app')!;

function esc(t: string): string {
	return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function pintar(html: string): void {
	app.innerHTML = html;
	app.querySelector<HTMLElement>('[autofocus]')?.focus();
}

function traducir(e: unknown): string {
	const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
	if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
	if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	if (/should be different/i.test(m)) return 'La contraseña nueva tiene que ser distinta de la anterior.';
	if (/password/i.test(m) && /weak|short|characters/i.test(m)) return `La contraseña es demasiado débil. Usa al menos ${MIN_CLAVE} caracteres, mezclando letras y números.`;
	if (/payload too large|exceeded the maximum/i.test(m)) return 'El archivo pesa más de 50 MB.';
	if (/failed to fetch|network/i.test(m)) return 'No hay conexión con el servidor. Revisa internet y vuelve a probar.';
	return 'Algo ha fallado: ' + m;
}

/** Conecta un formulario: desactiva el botón mientras trabaja y muestra errores. */
function alEnviar(form: HTMLFormElement, accion: (datos: FormData) => Promise<void>): void {
	const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
	const error = form.querySelector<HTMLElement>('.error')!;
	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		boton.disabled = true;
		error.textContent = '';
		try {
			await accion(new FormData(form));
		} catch (e) {
			error.textContent = traducir(e);
			boton.disabled = false;
		}
	});
}

const CABECERA = '<p class="marca">MUNE · Portal de promotoras</p>';
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

// ── Decide qué pantalla toca ──────────────────────────────────────────────

async function decidir(): Promise<void> {
	const { data: { session } } = await sb.auth.getSession();
	if (!session) {
		if (errorEnlace) return pantallaEntrada('El enlace del email ha caducado o ya se usó. Si es tu primera vez, pide que te reenvíen la invitación; si no, usa «¿Has olvidado tu contraseña?».');
		return pantallaEntrada();
	}
	if (tipoEnlace === 'invite' || tipoEnlace === 'recovery') return pantallaClave(tipoEnlace);
	return navegar();
}

// ── Entrar ────────────────────────────────────────────────────────────────

function pantallaEntrada(aviso = ''): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Entrar</h1>
		${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
		<label>Correo <input name="correo" type="email" autocomplete="username" required autofocus></label>
		<label>Contraseña <input name="clave" type="password" autocomplete="current-password" required></label>
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Entrar</button>
		<button class="enlace" type="button" data-olvido>¿Has olvidado tu contraseña?</button>
	</form>`);
	app.querySelector('[data-olvido]')!.addEventListener('click', pantallaOlvido);
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.signInWithPassword({
			email: String(d.get('correo')).trim(),
			password: String(d.get('clave')),
		});
		if (error) throw error;
		await navegar();
	});
}

function pantallaOlvido(): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Contraseña nueva</h1>
		<p>Escribe tu correo. Si tiene acceso al portal, te llegará un email con un enlace para elegir una contraseña nueva.</p>
		<label>Correo <input name="correo" type="email" autocomplete="username" required autofocus></label>
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Enviar el enlace</button>
		<button class="enlace" type="button" data-volver>Volver</button>
	</form>`);
	app.querySelector('[data-volver]')!.addEventListener('click', () => pantallaEntrada());
	alEnviar(app.querySelector('form')!, async (d) => {
		const correo = String(d.get('correo')).trim();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('Escribe un correo válido.');
		const { error } = await sb.auth.resetPasswordForEmail(correo, { redirectTo: `${location.origin}/` });
		if (error) throw error;
		pantallaEntrada('Si ese correo tiene acceso, en unos minutos te llegará el email. Revisa también la carpeta de correo no deseado.');
	});
}

// ── Elegir contraseña (invitación o contraseña olvidada) ─────────────────

function pantallaClave(tipo: 'invite' | 'recovery'): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>${tipo === 'invite' ? 'Te damos la bienvenida' : 'Elige una contraseña nueva'}</h1>
		<p>${tipo === 'invite' ? 'Elige la contraseña con la que entrarás al portal a partir de ahora. ' : ''}Usa al menos ${MIN_CLAVE} caracteres. Te recomendamos guardarla en un gestor de contraseñas.</p>
		<label>Contraseña <input name="clave" type="password" autocomplete="new-password" minlength="${MIN_CLAVE}" required autofocus></label>
		<label>Repite la contraseña <input name="repetida" type="password" autocomplete="new-password" required></label>
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Guardar y entrar</button>
	</form>`);
	alEnviar(app.querySelector('form')!, async (d) => {
		const clave = String(d.get('clave'));
		if (clave.length < MIN_CLAVE) throw new Error(`La contraseña tiene que tener al menos ${MIN_CLAVE} caracteres.`);
		if (clave !== String(d.get('repetida'))) throw new Error('Las dos contraseñas no coinciden.');
		const { error } = await sb.auth.updateUser({ password: clave });
		if (error) throw error;
		await navegar();
	});
}

// ── Navegación: #/ (inicio) y #/promocion/<id> ───────────────────────────

interface DatosFiscales { razon_social: string | null; cif: string | null; domicilio_fiscal: string | null }
interface Promotora extends DatosFiscales { id: string; nombre: string; contacto: string | null }
interface Acceso { nombre: string; cargo: string; promotoras: Promotora | null }
let acceso: Acceso | null = null;

async function navegar(): Promise<void> {
	const { data, error } = await sb.from('miembros')
		.select('nombre, cargo, promotoras(id, nombre, razon_social, cif, domicilio_fiscal, contacto)').limit(1).maybeSingle();
	if (error) throw error;
	if (!data) {
		await sb.auth.signOut();
		pintar(`<div class="caja">${CABECERA}<h1>Sin acceso</h1>
			<p>Esta cuenta no tiene acceso al portal ahora mismo. Si crees que es un error, contacta con MUNE Projects.</p>
			<button class="boton secundario" type="button" data-volver>Volver</button></div>`);
		app.querySelector('[data-volver]')!.addEventListener('click', () => pantallaEntrada());
		return;
	}
	acceso = data as unknown as Acceso;
	const ruta = location.hash.match(/^#\/promocion\/([a-z0-9-]{1,60})$/);
	return ruta ? pantallaPromocion(ruta[1]) : pantallaInicio();
}

addEventListener('hashchange', () => { if (acceso) void navegar().catch(fallo); });

function cabeceraSesion(): string {
	return `<div class="cabecera">
		<div>${CABECERA}<h1>${esc(acceso?.promotoras?.nombre ?? '')}</h1>
			<p class="rol">${esc(acceso?.nombre ?? '')}${acceso?.cargo ? ` · ${esc(acceso.cargo)}` : ''}</p></div>
		<button class="boton secundario" type="button" data-salir>Salir</button>
	</div>`;
}

/** Formulario de datos fiscales (de la promotora o de una promoción). */
function formFiscal(d: DatosFiscales & { contacto?: string | null }, conContacto: boolean, conCopiar: boolean): string {
	return `<form class="peticion-form" data-fiscal novalidate>
		${conCopiar ? '<button class="boton secundario pequeno" type="button" data-copiar>Copiar los datos de la promotora</button>' : ''}
		<label>Razón social <input name="razon_social" maxlength="200" value="${esc(d.razon_social ?? '')}"></label>
		<label>CIF <input name="cif" maxlength="20" value="${esc(d.cif ?? '')}"></label>
		<label>Domicilio fiscal <input name="domicilio_fiscal" maxlength="300" value="${esc(d.domicilio_fiscal ?? '')}"></label>
		${conContacto ? `<label>Persona de contacto (nombre, correo o teléfono) <input name="contacto" maxlength="300" value="${esc(d.contacto ?? '')}"></label>` : ''}
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar datos</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

function formFicha(p: Ficha): string {
	const num = (n: number | null) => n === null ? '' : String(n);
	return `<form class="peticion-form" data-ficha novalidate>
		<label>Dirección <input name="direccion" maxlength="200" autocomplete="street-address" value="${esc(p.direccion ?? '')}"></label>
		<label>Código postal <input name="codigo_postal" inputmode="numeric" maxlength="5" value="${esc(p.codigo_postal ?? '')}"></label>
		<label>Municipio <input name="municipio" maxlength="120" value="${esc(p.municipio ?? '')}"></label>
		<label>Provincia <input name="provincia" maxlength="120" value="${esc(p.provincia ?? '')}"></label>
		<label>Referencia catastral de la parcela <input name="referencia_catastral" maxlength="40" value="${esc(p.referencia_catastral ?? '')}"></label>
		<label>Tipo <select name="tipo"><option value="">Elige una opción</option>
			<option value="plurifamiliar" ${p.tipo === 'plurifamiliar' ? 'selected' : ''}>Plurifamiliar (edificio de viviendas)</option>
			<option value="unifamiliar" ${p.tipo === 'unifamiliar' ? 'selected' : ''}>Unifamiliar (viviendas independientes)</option></select></label>
		<label>Número de viviendas <input name="num_viviendas" type="number" min="1" max="5000" value="${num(p.num_viviendas)}"></label>
		<label>Número de portales o bloques <input name="num_portales" type="number" min="1" max="500" value="${num(p.num_portales)}"></label>
		<label>Número de plantas <input name="num_plantas" type="number" min="1" max="100" value="${num(p.num_plantas)}"></label>
		<label>Fecha prevista de entrega (opcional) <input name="fecha_entrega" type="date" value="${esc(p.fecha_entrega ?? '')}"></label>
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar ficha</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

function datosFicha(promocion: string, d: FormData): Record<string, unknown> {
	const entero = (k: string) => { const v = String(d.get(k) ?? '').trim(); return v ? Number(v) : null; };
	const cp = String(d.get('codigo_postal') ?? '').trim();
	if (cp && !/^[0-9]{5}$/.test(cp)) throw new Error('El código postal tiene que tener 5 cifras.');
	return {
		p_promocion: promocion,
		p_direccion: String(d.get('direccion') ?? ''), p_codigo_postal: cp,
		p_municipio: String(d.get('municipio') ?? ''), p_provincia: String(d.get('provincia') ?? ''),
		p_referencia_catastral: String(d.get('referencia_catastral') ?? ''), p_tipo: String(d.get('tipo') ?? ''),
		p_num_viviendas: entero('num_viviendas'), p_num_portales: entero('num_portales'), p_num_plantas: entero('num_plantas'),
		p_fecha_entrega: String(d.get('fecha_entrega') ?? '') || null,
	};
}

/** Conecta un formulario de datos a la función que los guarda y muestra «Guardado». */
function conectarFormulario(selector: string, guardar: (d: FormData) => PromiseLike<{ error: unknown }>): HTMLFormElement {
	const form = app.querySelector<HTMLFormElement>(selector)!;
	alEnviar(form, async (d) => {
		const { error } = await guardar(d);
		if (error) throw error;
		form.querySelector<HTMLElement>('[data-guardado]')!.textContent = '✓ Datos guardados.';
		form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
	});
	return form;
}

/** Conecta el formulario de datos fiscales a la función que los guarda. */
function conectarFiscal(guardar: (d: FormData) => PromiseLike<{ error: unknown }>): void {
	const form = conectarFormulario('[data-fiscal]', guardar);
	form.querySelector('[data-copiar]')?.addEventListener('click', () => {
		const po = acceso?.promotoras;
		if (!po) return;
		for (const campo of ['razon_social', 'cif', 'domicilio_fiscal'] as const) {
			form.querySelector<HTMLInputElement>(`input[name=${campo}]`)!.value = po[campo] ?? '';
		}
	});
}

// ── Inicio: promociones ───────────────────────────────────────────────────

const ESTADOS_PROMO: Record<string, [string, string]> = {
	documentacion: ['Recogiendo documentación', 'pendiente'],
	en_produccion: ['En producción', 'pendiente'],
	en_validacion: ['Planos para validar', 'pendiente'],
	publicada: ['Publicada', 'al-dia'],
};

async function pantallaInicio(): Promise<void> {
	const { data, error } = await sb.from('promociones').select('id, nombre, ubicacion, estado').order('nombre');
	if (error) throw error;
	const lista = data ?? [];
	pintar(`<div class="escritorio">
		${cabeceraSesion()}
		<section class="tarjeta">
			<h2>Tus promociones</h2>
			${lista.length ? `<div class="lista-promos">${lista.map((p) => {
				const [etiqueta, clase] = ESTADOS_PROMO[p.estado] ?? [p.estado, ''];
				return `<a class="promo-enlace" href="#/promocion/${esc(p.id)}">
					<span><strong>${esc(p.nombre)}</strong><br><span class="promo-lugar">${esc(p.ubicacion)}</span></span>
					<span class="estado ${clase}">${esc(etiqueta)}</span>
				</a>`;
			}).join('')}</div>` : '<p class="vacio">Todavía no hay promociones. Cuando MUNE Projects dé de alta la primera, aparecerá aquí.</p>'}
		</section>
		<section class="tarjeta">
			<h2>Datos de ${esc(acceso?.promotoras?.nombre ?? 'la promotora')}</h2>
			<p class="ayuda">Los datos generales de la promotora. Cada promoción tiene además los suyos propios, por si es una sociedad distinta.</p>
			${formFiscal(acceso?.promotoras ?? { razon_social: null, cif: null, domicilio_fiscal: null }, true, false)}
		</section>
	</div>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
	conectarFiscal((d) => sb.rpc('guardar_datos_promotora', {
		p_promotora: acceso!.promotoras!.id, p_razon_social: String(d.get('razon_social')), p_cif: String(d.get('cif')),
		p_domicilio_fiscal: String(d.get('domicilio_fiscal')), p_contacto: String(d.get('contacto')),
	}).then(async (r) => {
		// Para que «Copiar los datos de la promotora» use los datos recién guardados.
		if (!r.error) await navegarSinPintar();
		return r;
	}));
}

/** Vuelve a leer los datos de la sesión (promotora) sin cambiar de pantalla. */
async function navegarSinPintar(): Promise<void> {
	const { data } = await sb.from('miembros')
		.select('nombre, cargo, promotoras(id, nombre, razon_social, cif, domicilio_fiscal, contacto)').limit(1).maybeSingle();
	if (data) acceso = data as unknown as Acceso;
}

// ── Una promoción: documentación, planos y entregables, versión publicada ─

interface Requisito { id: number; bloque: string; elemento: string; descripcion: string; obligatorio: boolean; orden: number; plantilla: string | null }
interface Ficha {
	direccion: string | null; codigo_postal: string | null; municipio: string | null; provincia: string | null;
	referencia_catastral: string | null; tipo: string | null; num_viviendas: number | null; num_portales: number | null;
	num_plantas: number | null; fecha_entrega: string | null;
}
interface Documento { id: number; requisito_id: number; nombre: string; ruta: string; version: number; estado: string; nota: string | null; subido_en: string }
interface Entregable { id: number; version: string; tipo: string; tipologia: string | null; nombre: string; ruta: string }
interface Validacion { entregable_id: number; decision: string; comentario: string | null; momento: string }

const TIPOS_ENTREGABLE: Record<string, string> = { plano: 'Plano comercial', infografia: 'Infografía', pdf: 'PDF' };
const numVersion = (v: string) => Number(v.slice(1));

async function pantallaPromocion(id: string): Promise<void> {
	const [promo, reqs, docs, entr, vals] = await Promise.all([
		sb.from('promociones').select(`id, nombre, ubicacion, promotora_id, razon_social, cif, domicilio_fiscal, direccion, codigo_postal,
			municipio, provincia, referencia_catastral, tipo, num_viviendas, num_portales, num_plantas, fecha_entrega`).eq('id', id).maybeSingle(),
		sb.from('requisitos').select('id, bloque, elemento, descripcion, obligatorio, orden, plantilla').eq('promocion_id', id).order('orden').order('id'),
		sb.from('documentos').select('id, requisito_id, nombre, ruta, version, estado, nota, subido_en').eq('promocion_id', id).order('version', { ascending: false }),
		sb.from('entregables').select('id, version, tipo, tipologia, nombre, ruta').eq('promocion_id', id).order('creado_en', { ascending: false }),
		sb.from('validaciones').select('entregable_id, decision, comentario, momento').eq('promocion_id', id),
	]);
	for (const r of [promo, reqs, docs, entr, vals]) if (r.error) throw r.error;
	if (!promo.data) {
		location.hash = '#/';
		return;
	}
	const p = promo.data;
	const requisitos = (reqs.data ?? []) as Requisito[];
	const documentos = (docs.data ?? []) as Documento[];
	const entregables = (entr.data ?? []) as Entregable[];
	const validaciones = new Map(((vals.data ?? []) as Validacion[]).map((v) => [v.entregable_id, v]));

	// Documentación agrupada por bloque, en el orden de la lista.
	const bloques = new Map<string, Requisito[]>();
	for (const r of requisitos) bloques.set(r.bloque, [...(bloques.get(r.bloque) ?? []), r]);
	const htmlDocs = [...bloques].map(([bloque, rs]) => `<div class="bloque"><h3>${esc(bloque)}</h3>${rs.map((r) => {
		const versiones = documentos.filter((d) => d.requisito_id === r.id);
		const ultimo = versiones[0];
		const estado = !ultimo ? (r.obligatorio ? ['Falta por entregar', 'pendiente'] : ['Opcional', ''])
			: ultimo.estado === 'vigente' ? ['Revisado y vigente', 'al-dia']
			: ultimo.estado === 'rechazado' ? ['Rechazado: sube una versión nueva', 'rechazado']
			: ['Recibido · en revisión', ''];
		return `<article class="requisito">
			<div class="requisito-cabeza">
				<span class="requisito-nombre">${esc(r.elemento)}</span>
				<span class="estado ${estado[1]}">${esc(estado[0])}</span>
			</div>
			${r.descripcion ? `<p class="requisito-desc">${esc(r.descripcion)}</p>` : ''}
			${r.plantilla ? `<a class="enlace" href="${esc(r.plantilla)}" download>Descargar la plantilla</a>` : ''}
			${ultimo?.estado === 'rechazado' && ultimo.nota ? `<p class="requisito-nota">${esc(ultimo.nota)}</p>` : ''}
			${versiones.length ? `<div class="historial">${versiones.map((d) => `<div class="historial-fila">
				<span>v${d.version} · ${esc(d.nombre)} · ${esc(fecha(d.subido_en))}</span>
				<button class="enlace" type="button" data-bajar="documentos" data-ruta="${esc(d.ruta)}" data-nombre="${esc(d.nombre)}">Descargar</button>
			</div>`).join('')}</div>` : ''}
			<div class="acciones">
				<label class="boton secundario pequeno subir">${versiones.length ? 'Subir versión nueva' : 'Subir archivo'}
					<input type="file" data-subir="${r.id}">
				</label>
			</div>
			<p class="aviso" data-progreso="${r.id}" role="status" hidden></p>
		</article>`;
	}).join('')}</div>`).join('');

	// Entregables por versión, de la más reciente a la más antigua.
	const porVersion = new Map<string, Entregable[]>();
	for (const e of [...entregables].sort((a, b) => numVersion(b.version) - numVersion(a.version))) {
		porVersion.set(e.version, [...(porVersion.get(e.version) ?? []), e]);
	}
	const htmlEntr = [...porVersion].map(([version, es]) => `<div class="bloque"><h3>Versión ${esc(version.slice(1))}</h3>${es.map((e) => {
		const v = validaciones.get(e.id);
		const validacion = e.tipo !== 'plano' ? ''
			: !v ? '<span class="estado pendiente">Pendiente de validación</span>'
			: v.decision === 'aprobado' ? `<span class="estado al-dia">Aprobado el ${esc(fecha(v.momento))}</span>`
			: `<span class="estado rechazado">Rechazado el ${esc(fecha(v.momento))}</span>`;
		return `<div class="entregable">
			<span>${esc(TIPOS_ENTREGABLE[e.tipo] ?? e.tipo)}${e.tipologia ? ` · tipología ${esc(e.tipologia)}` : ''}<br><span class="promo-lugar">${esc(e.nombre)}</span></span>
			<span class="acciones">${validacion}
				<button class="boton secundario pequeno" type="button" data-bajar="entregables" data-ruta="${esc(e.ruta)}" data-nombre="${esc(e.nombre)}">Descargar</button>
			</span>
		</div>`;
	}).join('')}</div>`).join('');

	pintar(`<div class="escritorio">
		${cabeceraSesion()}
		<a class="enlace volver" href="#/">← Tus promociones</a>
		<section class="tarjeta">
			<h2>${esc(p.nombre)}</h2>
			<p class="promo-lugar">${esc(p.ubicacion)}</p>
			<p class="promo-versiones" data-publicada>Comprobando la versión publicada…</p>
		</section>
		<section class="tarjeta">
			<h2>Ficha de la promoción</h2>
			<p class="ayuda">Los datos básicos del proyecto. La referencia catastral nos sirve para recrear el entorno de la parcela.</p>
			${formFicha(p as unknown as Ficha)}
		</section>
		<section class="tarjeta">
			<h2>Documentación</h2>
			<p class="ayuda">Lo que necesitamos para preparar la promoción. Puedes subir archivos de hasta 50 MB; si te equivocas, sube una versión nueva: las anteriores se conservan.</p>
			${htmlDocs || '<p class="vacio">MUNE Projects todavía no ha preparado la lista de documentos de esta promoción.</p>'}
		</section>
		<section class="tarjeta">
			<h2>Planos y entregables</h2>
			${htmlEntr || '<p class="vacio">Todavía no hay planos ni entregables. Aparecerán aquí cuando estén listos.</p>'}
		</section>
		<section class="tarjeta">
			<h2>Datos fiscales de la promoción</h2>
			<p class="ayuda">La sociedad de esta promoción. Si es la misma que la de la promotora, pulsa «Copiar los datos de la promotora».</p>
			${formFiscal(p, false, true)}
		</section>
	</div>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
	conectarFormulario('[data-ficha]', (d) => sb.rpc('guardar_ficha_promocion', datosFicha(p.id, d)));
	conectarFiscal((d) => sb.rpc('guardar_datos_promocion', {
		p_promocion: p.id, p_razon_social: String(d.get('razon_social')), p_cif: String(d.get('cif')), p_domicilio_fiscal: String(d.get('domicilio_fiscal')),
	}));
	void pintarPublicada(p.id);

	app.querySelectorAll<HTMLButtonElement>('[data-bajar]').forEach((b) => b.addEventListener('click', () => void descargar(b)));
	app.querySelectorAll<HTMLInputElement>('[data-subir]').forEach((input) => input.addEventListener('change', () => {
		const archivo = input.files?.[0];
		if (archivo) void subir(p.id, p.promotora_id, Number(input.dataset.subir), archivo, input);
	}));
}

async function pintarPublicada(id: string): Promise<void> {
	const destino = app.querySelector<HTMLElement>('[data-publicada]');
	if (!destino) return;
	try {
		const r = await fetch(`${ESCAPARATE}/${encodeURIComponent(id)}/version.json`, { cache: 'no-store' });
		if (!r.ok) throw new Error();
		const v = await r.json() as { version: string; fecha: string };
		destino.innerHTML = `Versión publicada: <strong>${esc(v.version)}</strong> · ${esc(fecha(v.fecha))} ·
			<a href="${esc(`${ESCAPARATE}/${id}/`)}" target="_blank" rel="noopener noreferrer">Ver la web pública</a>`;
	} catch {
		destino.textContent = 'Todavía no hay ninguna versión publicada.';
	}
}

/** Descarga con un enlace temporal (1 minuto) que solo se crea si hay permiso. */
async function descargar(b: HTMLButtonElement): Promise<void> {
	b.disabled = true;
	try {
		const { data, error } = await sb.storage.from(b.dataset.bajar!).createSignedUrl(b.dataset.ruta!, 60, { download: b.dataset.nombre! });
		if (error) throw error;
		const a = document.createElement('a');
		a.href = data.signedUrl;
		a.rel = 'noopener';
		a.click();
	} catch (e) {
		alert(traducir(e));
	} finally {
		b.disabled = false;
	}
}

async function huella(archivo: File): Promise<string> {
	const h = await crypto.subtle.digest('SHA-256', await archivo.arrayBuffer());
	return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Nombre seguro para el almacén: sin tildes, espacios ni símbolos raros. */
function nombreSeguro(nombre: string): string {
	return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-100) || 'archivo';
}

async function subir(promocion: string, promotora: string, requisito: number, archivo: File, input: HTMLInputElement): Promise<void> {
	const aviso = app.querySelector<HTMLElement>(`[data-progreso="${requisito}"]`)!;
	aviso.hidden = false;
	aviso.classList.remove('error');
	input.disabled = true;
	try {
		if (archivo.size > MAX_TAM) throw new Error('El archivo pesa más de 50 MB. Si es más grande, contacta con MUNE Projects.');
		if (archivo.size === 0) throw new Error('El archivo está vacío.');
		aviso.textContent = `Subiendo «${archivo.name}»… Con archivos grandes puede tardar un poco; no cierres la página.`;
		const ruta = `${promotora}/${promocion}/${requisito}/${Date.now()}-${nombreSeguro(archivo.name)}`;
		const tipo = archivo.type || 'application/octet-stream';
		const [firma, subida] = await Promise.all([
			huella(archivo),
			sb.storage.from('documentos').upload(ruta, archivo, { contentType: tipo, upsert: false }),
		]);
		if (subida.error) throw subida.error;
		const { data: subido, error } = await sb.from('documentos').insert({
			promocion_id: promocion, requisito_id: requisito, nombre: archivo.name.slice(0, 200), ruta, tipo: tipo.slice(0, 120), tamano: archivo.size, huella: firma,
		}).select('id').single();
		if (error) throw error;
		// Aviso por email a MUNE Projects (si falla, el documento ya está subido igualmente).
		void sb.functions.invoke('aviso-subida', { body: { documento_id: subido.id } }).catch(() => undefined);
		await pantallaPromocion(promocion);
		const nuevo = app.querySelector<HTMLElement>(`[data-progreso="${requisito}"]`);
		if (nuevo) {
			nuevo.hidden = false;
			nuevo.textContent = `✓ «${archivo.name}» recibido. Lo revisaremos y verás aquí su estado.`;
		}
	} catch (e) {
		aviso.classList.add('error');
		aviso.textContent = traducir(e);
		input.disabled = false;
		input.value = '';
	}
}

// ── Sesión ────────────────────────────────────────────────────────────────

async function salir(): Promise<void> {
	acceso = null;
	await sb.auth.signOut();
	history.replaceState(null, '', location.pathname);
	pantallaEntrada();
}

let ultimaActividad = Date.now();
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true });
setInterval(async () => {
	if (Date.now() - ultimaActividad < INACTIVIDAD_MAX) return;
	const { data: { session } } = await sb.auth.getSession();
	if (session) await salir();
}, 60_000);

function fallo(e: unknown): void {
	pintar(`<div class="caja">${CABECERA}<h1>No se pudo cargar</h1><p class="error">${esc(traducir(e))}</p>
		<button class="boton" type="button" data-reintentar>Reintentar</button></div>`);
	app.querySelector('[data-reintentar]')!.addEventListener('click', () => location.reload());
}

decidir().catch(fallo);
