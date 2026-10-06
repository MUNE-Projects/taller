import { createClient, type Factor } from '@supabase/supabase-js';

// Datos públicos del proyecto de Supabase. La clave «publishable» está pensada
// para ir en el navegador: por sí sola no da acceso a nada, las reglas de la
// base de datos (supabase/001_panel.sql) exigen contraseña + código del móvil.
const SUPABASE_URL = 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';

// La sesión vive solo en esta pestaña y caduca tras un rato sin actividad.
const INACTIVIDAD_MAX = 30 * 60 * 1000;

const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
	auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
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
	const m = e instanceof Error ? e.message : String(e);
	if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
	if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	if (/invalid totp|invalid code|expired/i.test(m)) return 'Código incorrecto o caducado. Prueba con el código que aparece ahora en la app.';
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

const CABECERA = '<p class="marca">MUNE Inmobiliarias · Panel</p>';
const CAMPO_CODIGO = `<label>Código de 6 cifras
	<input class="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
</label>`;

// ── Decide qué pantalla toca ──────────────────────────────────────────────

async function decidir(): Promise<void> {
	const { data: { session } } = await sb.auth.getSession();
	if (!session) return pantallaEntrada();

	const { data: nivel, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
	if (error) throw error;
	if (nivel.currentLevel === 'aal2') return escritorio();

	const { data: factores, error: e2 } = await sb.auth.mfa.listFactors();
	if (e2) throw e2;
	const totp = factores.all.filter((f) => f.factor_type === 'totp');
	const verificado = totp.find((f) => f.status === 'verified');
	if (verificado) return pantallaCodigo(verificado);
	return pantallaAlta(totp);
}

// ── 1. Correo y contraseña ────────────────────────────────────────────────

function pantallaEntrada(): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Entrar</h1>
		<label>Correo <input name="correo" type="email" autocomplete="username" required autofocus></label>
		<label>Contraseña <input name="clave" type="password" autocomplete="current-password" required></label>
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Entrar</button>
	</form>`);
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.signInWithPassword({
			email: String(d.get('correo')).trim(),
			password: String(d.get('clave')),
		});
		if (error) throw error;
		await decidir();
	});
}

// ── 2a. Primera vez: vincular la app del móvil ────────────────────────────

async function pantallaAlta(pendientes: Factor[]): Promise<void> {
	// Un alta a medias (QR que no se llegó a confirmar) impide crear otra.
	for (const f of pendientes) await sb.auth.mfa.unenroll({ factorId: f.id });

	const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Móvil', issuer: 'MUNE Panel' });
	if (error) throw error;

	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Activa la doble verificación</h1>
		<p>1. Abre <strong>Google Authenticator</strong> (o Microsoft Authenticator) en el móvil.<br>
		2. Pulsa <strong>+</strong> y elige <strong>Escanear código QR</strong>.<br>
		3. Escribe aquí el código de 6 cifras que te muestre.</p>
		<div class="qr"><img alt="Código QR para la app de verificación" src="${esc(data.totp.qr_code)}"></div>
		<p class="secreto">¿No puedes escanear? Introduce a mano esta clave: ${esc(data.totp.secret)}</p>
		${CAMPO_CODIGO}
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Confirmar</button>
		<button class="boton secundario" type="button" data-salir>Salir</button>
	</form>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: String(d.get('codigo')).trim() });
		if (error) throw error;
		await anotar('activa doble verificación');
		await decidir();
	});
}

// ── 2b. Resto de veces: pedir el código ───────────────────────────────────

function pantallaCodigo(factor: Factor): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Código del móvil</h1>
		<p>Abre tu app de verificación y escribe el código de <strong>MUNE Panel</strong>.</p>
		${CAMPO_CODIGO}
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Verificar</button>
		<button class="boton secundario" type="button" data-salir>Salir</button>
	</form>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: String(d.get('codigo')).trim() });
		if (error) throw error;
		await decidir();
	});
}

// ── 3. Escritorio ─────────────────────────────────────────────────────────

interface Apunte { momento: string; accion: string }

// ── Promociones: lo publicado y lo que espera revisión ───────────────────
// La lista de promociones es privada (Supabase). La versión de cada una se lee
// de su version.json en producción y en la vista previa, y se comparan.

const ESCAPARATE = 'https://escaparate.mune-projects.workers.dev';
const REVISION = 'https://revision-escaparate.mune-projects.workers.dev';

interface Promocion { id: string; nombre: string; ubicacion: string; promotoras: { nombre: string } | null }
interface Version { version: string; fecha: string }

/** Versión de una promoción en un entorno; null si no está o no se pudo leer. */
async function leerVersion(base: string, id: string): Promise<Version | null | 'error'> {
	try {
		const r = await fetch(`${base}/${encodeURIComponent(id)}/version.json`, { cache: 'no-store' });
		if (r.status === 404) return null;
		if (!r.ok) return 'error';
		const v = await r.json() as Version;
		return typeof v.version === 'string' ? v : 'error';
	} catch {
		return 'error';
	}
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

function enlace(href: string, texto: string, accion: string, detalle: Record<string, string>, principal = false): string {
	return `<a class="boton${principal ? '' : ' secundario'}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"
		data-anotar="${esc(accion)}" data-detalle="${esc(JSON.stringify(detalle))}">${esc(texto)}</a>`;
}

/** Versiones anteriores a la indicada: v1 … v(n-1). */
function anteriores(version: string): string[] {
	const n = Number(version.slice(1));
	return Array.from({ length: Math.max(0, n - 1) }, (_, i) => `v${i + 1}`);
}

/**
 * Lanza el brazo ejecutor (función «ejecutar» de Supabase → GitHub Actions) y
 * sigue el resultado mirando la versión publicada hasta que cambia.
 */
async function ejecutar(id: string, orden: Record<string, string>, esperada: string): Promise<boolean> {
	const aviso = app.querySelector<HTMLElement>(`[data-progreso="${CSS.escape(id)}"]`)!;
	aviso.hidden = false;
	aviso.classList.remove('error');
	aviso.textContent = 'Enviando la orden…';
	const { error } = await sb.functions.invoke('ejecutar', { body: orden });
	if (error) {
		let texto = error.message;
		try { texto = (await (error as { context?: Response }).context?.json())?.error ?? texto; } catch { /* sin detalle */ }
		aviso.classList.add('error');
		aviso.textContent = `No se ha podido iniciar: ${texto}`;
		return false;
	}
	aviso.textContent = `En marcha. GitHub está ${orden.accion === 'aprobar' ? 'publicando' : 'restaurando'} ${esperada}; suele tardar 2–3 minutos. Puedes seguir usando el Panel.`;
	const inicio = Date.now();
	const mirar = async (): Promise<void> => {
		const v = await leerVersion(ESCAPARATE, id);
		if (v && v !== 'error' && v.version === esperada) {
			aviso.textContent = `✓ Hecho: los visitantes ya ven ${esperada}.`;
			setTimeout(() => void pintarPromociones(app.querySelector<HTMLElement>('[data-promociones]')!), 4000);
			return;
		}
		if (Date.now() - inicio > 8 * 60 * 1000) {
			aviso.classList.add('error');
			aviso.textContent = `Está tardando más de lo normal. Recarga en unos minutos; si sigue sin cambiar, dímelo en Claude Code.`;
			return;
		}
		setTimeout(() => void mirar(), 15000);
	};
	setTimeout(() => void mirar(), 30000);
	return true;
}

async function pintarPromociones(destino: HTMLElement): Promise<void> {
	const { data, error } = await sb.from('promociones').select('id, nombre, ubicacion, promotoras(nombre)').order('nombre');
	if (error) {
		destino.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const lista = (data ?? []) as unknown as Promocion[];
	if (!lista.length) {
		destino.innerHTML = '<p class="vacio">Todavía no hay promociones.</p>';
		return;
	}
	const versiones = await Promise.all(lista.map(async (p) =>
		[await leerVersion(ESCAPARATE, p.id), await leerVersion(REVISION, p.id)] as const));

	destino.innerHTML = lista.map((p, i) => {
		const id = p.id;
		const [pubL, revL] = versiones[i];
		const pub = pubL === 'error' ? null : pubL;
		const rev = revL === 'error' ? null : revL;
		const pendiente = rev && rev.version !== pub?.version;
		const estado = pubL === 'error' ? '<span class="estado">Publicada: no se pudo comprobar</span>'
			: !pub && !rev ? '<span class="estado">Sin versiones todavía</span>'
			: !pub ? '<span class="estado pendiente">Nueva · pendiente de tu revisión</span>'
			: pendiente ? `<span class="estado pendiente">${esc(rev.version)} pendiente de tu revisión</span>`
			: '<span class="estado al-dia">Al día</span>';
		const acciones = [
			pub ? enlace(`${ESCAPARATE}/${id}/`, `Ver publicada (${pub.version})`, 'abre la publicada', { id, version: pub.version }) : '',
			pendiente ? enlace(`${REVISION}/${id}/`, `Ver vista previa (${rev.version})`, 'abre la vista previa', { id, version: rev.version }, true) : '',
			pendiente ? `<button class="boton" type="button" data-publicar="${esc(id)}" data-version="${esc(rev.version)}" data-nombre="${esc(p.nombre)}">Publicar ${esc(rev.version)}</button>` : '',
			`<button class="boton secundario" type="button" data-pedir="${esc(id)}" data-version="${esc((rev ?? pub)?.version ?? '')}">Pedir cambios</button>`,
			pub && anteriores(pub.version).length ? `<button class="boton secundario" type="button" data-abrir-volver="${esc(id)}">Volver a una anterior</button>` : '',
		].join('');
		const lugar = [p.promotoras?.nombre, p.ubicacion].filter(Boolean).join(' · ');
		return `<article class="promo">
			<div class="promo-cabeza">
				<div><h3>${esc(p.nombre)}</h3><p class="promo-lugar">${esc(lugar)}</p></div>
				${estado}
			</div>
			<p class="promo-versiones">${pub ? `Publicada: <strong>${esc(pub.version)}</strong> · ${esc(fecha(pub.fecha))}` : pubL === 'error' ? 'Publicada: sin comprobar' : 'Sin publicar'}
				${pendiente ? ` · En revisión: <strong>${esc(rev.version)}</strong> · ${esc(fecha(rev.fecha))}` : ''}</p>
			<div class="acciones">${acciones}</div>
			<p class="aviso" data-progreso="${esc(id)}" role="status" hidden></p>
			${pub && anteriores(pub.version).length ? `<form class="peticion-form" data-volver="${esc(id)}" data-actual="${esc(pub.version)}" data-nombre="${esc(p.nombre)}" hidden novalidate>
				<label>Volver la web pública de ${esc(p.nombre)} a la versión
					<select name="version">${anteriores(pub.version).reverse().map((v) => `<option>${v}</option>`).join('')}</select>
				</label>
				<label>Motivo
					<input name="motivo" maxlength="500" required placeholder="Por ejemplo: la v8 tiene un error en el plano">
				</label>
				<p class="error" role="alert"></p>
				<div class="acciones">
					<button class="boton" type="submit">Volver</button>
					<button class="boton secundario" type="button" data-cancelar>Cancelar</button>
				</div>
			</form>` : ''}
			<form class="peticion-form" data-form="${esc(id)}" hidden novalidate>
				<label>¿Qué quieres cambiar de ${esc(p.nombre)}${(rev ?? pub) ? ` (${esc((rev ?? pub)!.version)})` : ''}?
					<textarea name="texto" rows="4" maxlength="4000" required
						placeholder="Por ejemplo: el suelo de la cocina más claro y el sofá del salón en gris."></textarea>
				</label>
				<label>Fotos de referencia (opcional, hasta ${MAX_FOTOS}: JPG, PNG o WebP, máx. 10 MB cada una)
					<input name="fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
				</label>
				<p class="error" role="alert"></p>
				<div class="acciones">
					<button class="boton" type="submit">Enviar petición</button>
					<button class="boton secundario" type="button" data-cancelar>Cancelar</button>
				</div>
			</form>
		</article>`;
	}).join('');

	destino.querySelectorAll<HTMLAnchorElement>('a[data-anotar]').forEach((a) => a.addEventListener('click', () => {
		void anotar(a.dataset.anotar!, JSON.parse(a.dataset.detalle ?? '{}'));
	}));

	destino.querySelectorAll<HTMLButtonElement>('[data-publicar]').forEach((b) => b.addEventListener('click', async () => {
		const { publicar: id, version, nombre } = b.dataset as Record<string, string>;
		if (!confirm(`¿Publicar ${version} de ${nombre}?\n\nSustituirá a la versión que ven ahora los visitantes.`)) return;
		b.disabled = true;
		const ok = await ejecutar(id, { accion: 'aprobar', promocion: id }, version);
		if (!ok) b.disabled = false;
	}));

	destino.querySelectorAll<HTMLButtonElement>('[data-abrir-volver]').forEach((b) => {
		const form = destino.querySelector<HTMLFormElement>(`form[data-volver="${CSS.escape(b.dataset.abrirVolver!)}"]`)!;
		const cerrar = () => { form.hidden = true; form.reset(); b.hidden = false; };
		b.addEventListener('click', () => { form.hidden = false; b.hidden = true; form.querySelector('select')!.focus(); });
		form.querySelector('[data-cancelar]')!.addEventListener('click', cerrar);
		alEnviar(form, async (d) => {
			const id = form.dataset.volver!;
			const version = String(d.get('version'));
			const motivo = String(d.get('motivo')).trim();
			if (motivo.length < 3) throw new Error('Indica el motivo.');
			if (!confirm(`¿Volver ${form.dataset.nombre} de ${form.dataset.actual} a ${version}?\n\nLos visitantes verán ${version}. La ${form.dataset.actual} se conserva y se puede recuperar.`)) {
				form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
				return;
			}
			const ok = await ejecutar(id, { accion: 'volver', promocion: id, version, motivo }, version);
			if (ok) cerrar(); else throw new Error('No se ha podido iniciar. Mira el aviso de arriba.');
		});
	});

	destino.querySelectorAll<HTMLButtonElement>('[data-pedir]').forEach((b) => {
		const form = destino.querySelector<HTMLFormElement>(`form[data-form="${CSS.escape(b.dataset.pedir!)}"]`)!;
		const cerrar = () => { form.hidden = true; form.reset(); b.hidden = false; };
		b.addEventListener('click', () => {
			form.hidden = false;
			b.hidden = true;
			form.querySelector('textarea')!.focus();
		});
		form.querySelector('[data-cancelar]')!.addEventListener('click', cerrar);
		alEnviar(form, async (d) => {
			const texto = String(d.get('texto')).trim();
			if (texto.length < 3) throw new Error('Escribe qué quieres cambiar.');
			const fotos = (d.getAll('fotos') as File[]).filter((f) => f.size > 0);
			comprobarFotos(fotos);
			const { data, error } = await sb.from('peticiones')
				.insert({ promocion_id: b.dataset.pedir, version: b.dataset.version || null, texto })
				.select('id').single();
			if (error) throw error;
			await subirFotos(data.id, fotos);
			await anotar('pide cambios', { id: b.dataset.pedir, peticion: data.id, fotos: fotos.length });
			cerrar();
			form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
			void pintarPeticiones(app.querySelector<HTMLElement>('[data-peticiones]')!);
		});
	});
}

// ── Fotos de referencia ───────────────────────────────────────────────────
// Almacén privado «referencias/<petición>/…» (supabase/004_referencias.sql).

const MAX_FOTOS = 5;
const MAX_TAM_FOTO = 10 * 1024 * 1024;
const TIPOS_FOTO: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function comprobarFotos(fotos: File[]): void {
	if (fotos.length > MAX_FOTOS) throw new Error(`Puedes adjuntar como máximo ${MAX_FOTOS} fotos.`);
	for (const f of fotos) {
		if (!TIPOS_FOTO[f.type]) throw new Error(`«${f.name}» no es JPG, PNG ni WebP.`);
		if (f.size > MAX_TAM_FOTO) throw new Error(`«${f.name}» pesa más de 10 MB.`);
	}
}

async function subirFotos(peticion: number, fotos: File[]): Promise<void> {
	for (const [i, f] of fotos.entries()) {
		const ruta = `${peticion}/${i + 1}.${TIPOS_FOTO[f.type]}`;
		const { error } = await sb.storage.from('referencias').upload(ruta, f, { contentType: f.type, upsert: false });
		if (error) throw new Error(`La petición se ha guardado, pero la foto «${f.name}» no se ha podido subir: ${error.message}`);
	}
}

/** Miniaturas de las fotos de una petición (enlaces temporales de 1 hora). */
async function miniaturas(peticion: number): Promise<string> {
	const { data: archivos } = await sb.storage.from('referencias').list(String(peticion));
	if (!archivos?.length) return '';
	const { data: urls } = await sb.storage.from('referencias')
		.createSignedUrls(archivos.map((a) => `${peticion}/${a.name}`), 3600);
	return `<div class="fotos">${(urls ?? []).filter((u) => u.signedUrl).map((u, i) =>
		`<a href="${esc(u.signedUrl!)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u.signedUrl!)}" alt="Foto de referencia ${i + 1}" loading="lazy"></a>`).join('')}</div>`;
}

// ── Peticiones de cambios ─────────────────────────────────────────────────
// Claude las atiende cuando la administradora se lo pide (de momento no hay
// ninguna tarea automática) y va marcando su estado.

interface Peticion {
	id: number; promocion_id: string; version: string | null; texto: string; estado: string;
	nota: string | null; enlace: string | null; creada_en: string; promociones: { nombre: string } | null;
}

const ESTADOS: Record<string, [string, string]> = {
	pendiente: ['Pendiente', 'pendiente'],
	en_curso: ['En curso', 'pendiente'],
	lista: ['Lista para revisar', 'al-dia'],
	descartada: ['Descartada', ''],
};

async function pintarPeticiones(destino: HTMLElement): Promise<void> {
	const { data, error } = await sb.from('peticiones')
		.select('id, promocion_id, version, texto, estado, nota, enlace, creada_en, promociones(nombre)')
		.order('creada_en', { ascending: false }).limit(30);
	if (error) {
		destino.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const lista = (data ?? []) as unknown as Peticion[];
	if (!lista.length) {
		destino.innerHTML = '<p class="vacio">No hay peticiones. Usa «Pedir cambios» en una promoción.</p>';
		return;
	}
	const fotos = await Promise.all(lista.map((p) => miniaturas(p.id)));
	destino.innerHTML = lista.map((p, i) => {
		const [etiqueta, clase] = ESTADOS[p.estado] ?? [p.estado, ''];
		return `<article class="peticion">
			<div class="promo-cabeza">
				<p class="promo-lugar">${esc(p.promociones?.nombre ?? p.promocion_id)}${p.version ? ` · ${esc(p.version)}` : ''} · ${esc(fecha(p.creada_en))}</p>
				<span class="estado ${clase}">${esc(etiqueta)}</span>
			</div>
			<p class="peticion-texto">${esc(p.texto)}</p>
			${fotos[i]}
			${p.nota ? `<p class="peticion-nota"><strong>Claude:</strong> ${esc(p.nota)}</p>` : ''}
			<div class="acciones">
				${p.enlace ? enlace(p.enlace, 'Ver propuesta', 'abre la propuesta de una petición', { peticion: String(p.id) }, true) : ''}
				${p.estado === 'pendiente' ? `<button class="boton secundario" type="button" data-descartar="${p.id}">Descartar</button>` : ''}
			</div>
		</article>`;
	}).join('');

	destino.querySelectorAll<HTMLAnchorElement>('a[data-anotar]').forEach((a) => a.addEventListener('click', () => {
		void anotar(a.dataset.anotar!, JSON.parse(a.dataset.detalle ?? '{}'));
	}));
	destino.querySelectorAll<HTMLButtonElement>('[data-descartar]').forEach((b) => b.addEventListener('click', async () => {
		b.disabled = true;
		const id = Number(b.dataset.descartar);
		const { error } = await sb.from('peticiones').update({ estado: 'descartada' }).eq('id', id);
		if (error) { b.disabled = false; alert(traducir(error)); return; }
		await anotar('descarta una petición', { peticion: id });
		void pintarPeticiones(destino);
	}));
}

async function escritorio(): Promise<void> {
	const { data: admin, error } = await sb.from('administradores').select('nombre').maybeSingle();
	if (error) throw error;
	if (!admin) {
		await sb.auth.signOut();
		pintar(`<div class="caja">${CABECERA}<h1>Sin acceso</h1>
			<p>Esta cuenta no tiene permiso para usar el panel.</p></div>`);
		return;
	}

	if (!sessionStorage.getItem('panel:entrada-anotada')) {
		await anotar('entra en el panel');
		sessionStorage.setItem('panel:entrada-anotada', '1');
	}

	const { data: apuntes } = await sb.from('registro').select('momento, accion').order('momento', { ascending: false }).limit(15);
	const filas = (apuntes as Apunte[] | null ?? []).map((a) =>
		`<tr><td>${esc(new Date(a.momento).toLocaleString('es-ES'))}</td><td>${esc(a.accion)}</td></tr>`).join('');

	pintar(`<div class="escritorio">
		<div class="cabecera">
			<div>${CABECERA}<h1>Hola</h1></div>
			<button class="boton secundario" type="button" data-salir>Salir</button>
		</div>
		<section class="tarjeta">
			<h2>Promociones</h2>
			<div data-promociones><p class="vacio">Consultando el escaparate…</p></div>
		</section>
		<section class="tarjeta">
			<h2>Peticiones de cambios</h2>
			<p class="ayuda">Cuando quieras que Claude se ponga con ellas, díselo en Claude Code: «revisa las peticiones del Panel».</p>
			<div data-peticiones><p class="vacio">Cargando…</p></div>
		</section>
		<section class="tarjeta">
			<h2>Registro de actividad</h2>
			${filas ? `<table><thead><tr><th>Cuándo</th><th>Qué</th></tr></thead><tbody>${filas}</tbody></table>`
				: '<p class="vacio">Sin actividad todavía.</p>'}
		</section>
	</div>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
	void pintarPromociones(app.querySelector<HTMLElement>('[data-promociones]')!);
	void pintarPeticiones(app.querySelector<HTMLElement>('[data-peticiones]')!);
}

// ── Utilidades de sesión ──────────────────────────────────────────────────

async function anotar(accion: string, detalle: Record<string, unknown> = {}): Promise<void> {
	await sb.from('registro').insert({ accion, detalle });
}

async function salir(): Promise<void> {
	sessionStorage.removeItem('panel:entrada-anotada');
	await sb.auth.signOut();
	pantallaEntrada();
}

let ultimaActividad = Date.now();
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true });
setInterval(async () => {
	if (Date.now() - ultimaActividad < INACTIVIDAD_MAX) return;
	const { data: { session } } = await sb.auth.getSession();
	if (session) await salir();
}, 60_000);

decidir().catch((e) => {
	pintar(`<div class="caja">${CABECERA}<h1>No se pudo cargar</h1><p class="error">${esc(traducir(e))}</p>
		<button class="boton" type="button" data-reintentar>Reintentar</button></div>`);
	app.querySelector('[data-reintentar]')!.addEventListener('click', () => location.reload());
});
