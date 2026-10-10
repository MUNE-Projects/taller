// Versiones de una promoción: lo publicado y lo que espera revisión.
//
// La versión de cada promoción se lee de su version.json en producción y en la
// vista previa del escaparate, y se comparan. Publicar y volver atrás pasan por
// el brazo ejecutor (función «ejecutar» de Supabase → GitHub Actions).

import { alEnviar, anotar, esc, fecha, sb } from './comun';
import { MOTIVO_NO_PUBLICAR, estadoPlanos, leerManifiesto, pintarPlanos, resumenListos } from './planos';

export const ESCAPARATE: string = import.meta.env.VITE_ESCAPARATE ?? 'https://escaparate.mune-projects.workers.dev';
export const REVISION: string = import.meta.env.VITE_REVISION ?? 'https://revision-escaparate.mune-projects.workers.dev';

export interface Version { version: string; fecha: string }
export interface EstadoVersiones { pub: Version | null; rev: Version | null; pendiente: boolean; sinComprobar: boolean }

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

/** Publicada y en revisión de una promoción. */
export async function estadoVersiones(id: string): Promise<EstadoVersiones> {
	const [pubL, revL] = await Promise.all([leerVersion(ESCAPARATE, id), leerVersion(REVISION, id)]);
	const pub = pubL === 'error' ? null : pubL;
	const rev = revL === 'error' ? null : revL;
	return { pub, rev, pendiente: !!rev && rev.version !== pub?.version, sinComprobar: pubL === 'error' };
}

/** Etiqueta de estado (Al día, vN pendiente de tu revisión…). */
export function etiquetaVersiones(e: EstadoVersiones): string {
	return e.sinComprobar ? '<span class="estado">Publicada: no se pudo comprobar</span>'
		: !e.pub && !e.rev ? '<span class="estado">Sin versiones todavía</span>'
		: !e.pub ? '<span class="estado pendiente">Nueva · pendiente de tu revisión</span>'
		: e.pendiente ? `<span class="estado pendiente">${esc(e.rev!.version)} pendiente de tu revisión</span>`
		: '<span class="estado al-dia">Al día</span>';
}

export function enlace(href: string, texto: string, accion: string, detalle: Record<string, string>, principal = false): string {
	return `<a class="boton${principal ? '' : ' secundario'}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"
		data-anotar="${esc(accion)}" data-detalle="${esc(JSON.stringify(detalle))}">${esc(texto)}</a>`;
}

/** Anota en el registro los clics en enlaces externos (vista previa, publicada…). */
export function anotarEnlaces(destino: HTMLElement): void {
	destino.querySelectorAll<HTMLAnchorElement>('a[data-anotar]').forEach((a) => a.addEventListener('click', () => {
		void anotar(a.dataset.anotar!, JSON.parse(a.dataset.detalle ?? '{}'));
	}));
}

/** Versiones anteriores a la indicada: v1 … v(n-1). */
function anteriores(version: string): string[] {
	const n = Number(version.slice(1));
	return Array.from({ length: Math.max(0, n - 1) }, (_, i) => `v${i + 1}`);
}

/**
 * Lanza el brazo ejecutor y sigue el resultado mirando la versión publicada
 * hasta que cambia. Al terminar, vuelve a pintar el bloque de versiones.
 */
async function ejecutar(aviso: HTMLElement, id: string, orden: Record<string, string>, esperada: string, repintar: () => void): Promise<boolean> {
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
			setTimeout(() => { if (aviso.isConnected) repintar(); }, 4000);
			return;
		}
		if (Date.now() - inicio > 8 * 60 * 1000) {
			aviso.classList.add('error');
			aviso.textContent = 'Está tardando más de lo normal. Recarga en unos minutos; si sigue sin cambiar, dímelo en Claude Code.';
			return;
		}
		setTimeout(() => void mirar(), 15000);
	};
	setTimeout(() => void mirar(), 30000);
	return true;
}

/** Bloque de versiones de una promoción: ver, publicar y volver a una anterior. */
export async function pintarVersiones(destino: HTMLElement, p: { id: string; nombre: string }): Promise<void> {
	destino.innerHTML = '<p class="vacio">Consultando el escaparate…</p>';
	const e = await estadoVersiones(p.id);
	const { pub, rev, pendiente } = e;
	const id = p.id;
	const volver = pub ? anteriores(pub.version) : [];
	// planos de la versión en revisión: sin todos aprobados no se publica
	const manifiesto = pendiente ? await leerManifiesto(REVISION, id, rev!.version) : null;
	const planos = pendiente ? await estadoPlanos(id, rev!.version).catch(() => []) : [];
	const listos = resumenListos(planos, !!manifiesto);
	const bloqueo = listos === 'listos' || listos === 'sin_planos' ? '' : MOTIVO_NO_PUBLICAR[listos];
	destino.innerHTML = `
		<div class="promo-cabeza">
			<p class="promo-versiones">${pub ? `Publicada: <strong>${esc(pub.version)}</strong> · ${esc(fecha(pub.fecha))}` : e.sinComprobar ? 'Publicada: sin comprobar' : 'Sin publicar'}
				${pendiente ? ` · En revisión: <strong>${esc(rev!.version)}</strong> · ${esc(fecha(rev!.fecha))}` : ''}</p>
			${etiquetaVersiones(e)}
		</div>
		<div class="acciones">
			${pub ? enlace(`${ESCAPARATE}/${id}/`, `Ver publicada (${pub.version})`, 'abre la publicada', { id, version: pub.version }) : ''}
			${pendiente ? enlace(`${REVISION}/${id}/`, `Ver vista previa (${rev!.version})`, 'abre la vista previa', { id, version: rev!.version }, true) : ''}
			${pendiente ? `<button class="boton" type="button" data-publicar ${bloqueo ? 'disabled' : ''}>Publicar ${esc(rev!.version)}</button>` : ''}
			${volver.length ? '<button class="boton secundario" type="button" data-abrir-volver>Volver a una anterior</button>' : ''}
		</div>
		${bloqueo ? `<p class="ayuda">${esc(bloqueo)}</p>` : ''}
		<p class="aviso" data-progreso role="status" hidden></p>
		<div data-planos></div>
		${volver.length ? `<form class="peticion-form" data-volver hidden novalidate>
			<label>Volver la web pública de ${esc(p.nombre)} a la versión
				<select name="version">${volver.reverse().map((v) => `<option>${v}</option>`).join('')}</select>
			</label>
			<label>Motivo
				<input name="motivo" maxlength="500" required placeholder="Por ejemplo: la ${esc(pub!.version)} tiene un error en el plano">
			</label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Volver</button>
				<button class="boton secundario" type="button" data-cancelar>Cancelar</button>
			</div>
		</form>` : ''}`;

	const aviso = destino.querySelector<HTMLElement>('[data-progreso]')!;
	const repintar = () => void pintarVersiones(destino, p);
	anotarEnlaces(destino);
	if (pendiente) pintarPlanos(destino.querySelector<HTMLElement>('[data-planos]')!, REVISION, id, rev!.version, manifiesto, planos, repintar);

	destino.querySelector<HTMLButtonElement>('[data-publicar]')?.addEventListener('click', async (ev) => {
		const b = ev.currentTarget as HTMLButtonElement;
		if (!confirm(`¿Publicar ${rev!.version} de ${p.nombre}?\n\nSustituirá a la versión que ven ahora los visitantes.`)) return;
		b.disabled = true;
		const ok = await ejecutar(aviso, id, { accion: 'aprobar', promocion: id, version: rev!.version }, rev!.version, repintar);
		if (!ok) b.disabled = false;
	});

	const abrir = destino.querySelector<HTMLButtonElement>('[data-abrir-volver]');
	const form = destino.querySelector<HTMLFormElement>('form[data-volver]');
	if (abrir && form) {
		const cerrar = () => { form.hidden = true; form.reset(); abrir.hidden = false; };
		abrir.addEventListener('click', () => { form.hidden = false; abrir.hidden = true; form.querySelector('select')!.focus(); });
		form.querySelector('[data-cancelar]')!.addEventListener('click', cerrar);
		alEnviar(form, async (d) => {
			const version = String(d.get('version'));
			const motivo = String(d.get('motivo')).trim();
			if (motivo.length < 3) throw new Error('Indica el motivo.');
			if (!confirm(`¿Volver ${p.nombre} de ${pub!.version} a ${version}?\n\nLos visitantes verán ${version}. La ${pub!.version} se conserva y se puede recuperar.`)) {
				form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
				return;
			}
			const ok = await ejecutar(aviso, id, { accion: 'volver', promocion: id, version, motivo }, version, repintar);
			if (ok) cerrar(); else throw new Error('No se ha podido iniciar. Mira el aviso de arriba.');
		});
	}
}
