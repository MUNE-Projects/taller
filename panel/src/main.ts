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
			<p class="aviso">Pendiente de conectar con el taller. Aquí verás cada promoción, la versión publicada,
			la que está esperando tu revisión, y los botones para revisar, publicar o volver atrás.</p>
		</section>
		<section class="tarjeta">
			<h2>Registro de actividad</h2>
			${filas ? `<table><thead><tr><th>Cuándo</th><th>Qué</th></tr></thead><tbody>${filas}</tbody></table>`
				: '<p class="vacio">Sin actividad todavía.</p>'}
		</section>
	</div>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
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
