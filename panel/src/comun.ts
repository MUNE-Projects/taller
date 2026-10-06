import { createClient } from '@supabase/supabase-js';

// Datos públicos del proyecto de Supabase. La clave «publishable» está pensada
// para ir en el navegador: por sí sola no da acceso a nada, las reglas de la
// base de datos (supabase/001_panel.sql) exigen contraseña + código del móvil.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA: string = import.meta.env.VITE_SUPABASE_CLAVE ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';

// La sesión vive solo en esta pestaña y caduca tras un rato sin actividad.
export const INACTIVIDAD_MAX = 30 * 60 * 1000;

export const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
	auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export function esc(t: string): string {
	return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function traducir(e: unknown): string {
	const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
	if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
	if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	if (/invalid totp|invalid code|expired/i.test(m)) return 'Código incorrecto o caducado. Prueba con el código que aparece ahora en la app.';
	if (/failed to fetch|network/i.test(m)) return 'No hay conexión con el servidor. Revisa internet y vuelve a probar.';
	return 'Algo ha fallado: ' + m;
}

/** Conecta un formulario: desactiva el botón mientras trabaja y muestra errores. */
export function alEnviar(form: HTMLFormElement, accion: (datos: FormData) => Promise<void>): void {
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

export const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

export async function anotar(accion: string, detalle: Record<string, unknown> = {}): Promise<void> {
	await sb.from('registro').insert({ accion, detalle });
}
