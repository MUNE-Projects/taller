// Planos comerciales de cada versión y su validación por la promotora (Etapa 4).
//
// Al preparar una versión, sus planos (uno por tipología y variante, o por
// vivienda) se generan y van a la vista previa con una lista, planos.json.
// Cuando la administradora ha revisado la vista previa, «Enviar los planos a la
// promotora» los copia al almacén privado «entregables» (comprobando su huella)
// y los apunta en la base de datos: desde ese momento el equipo de la promotora
// los ve en su portal y los aprueba o pide cambios. La versión solo se puede
// publicar con todos sus planos aprobados (011_planos.sql, función «ejecutar»).

import { avisarPromotora } from './avisos';
import { anotar, esc, fecha, sb, traducir } from './comun';

export interface PlanoManifiesto {
	clave: string; titulo: string; detalle: string; viviendas: string; orden: number;
	pdf: string; miniatura: string; huella: string; huellaDatos: string;
}
interface Manifiesto { promocion: string; version: string; planos: PlanoManifiesto[] }

export interface PlanoEstado {
	id: number; clave: string; titulo: string; detalle: string | null; viviendas: string | null;
	ruta: string; miniatura: string | null; decision: 'aprobado' | 'rechazado' | null;
	comentario: string | null; momento: string | null; persona: string | null; heredada_de: string | null;
}

export type Listos = 'sin_planos' | 'sin_enviar' | 'pendientes' | 'cambios' | 'listos';

/** Lista de planos de la vista previa (null si la versión no tiene planos generados). */
export async function leerManifiesto(revision: string, id: string, version: string): Promise<Manifiesto | null> {
	try {
		const r = await fetch(`${revision}/${encodeURIComponent(id)}/planos/planos.json`, { cache: 'no-store' });
		if (!r.ok) return null;
		const m = await r.json() as Manifiesto;
		return m.version === version && Array.isArray(m.planos) ? m : null;
	} catch {
		return null;
	}
}

export async function estadoPlanos(id: string, version: string): Promise<PlanoEstado[]> {
	const { data, error } = await sb.rpc('planos_de_version', { p_promocion: id, p_version: version });
	if (error) throw error;
	return (data ?? []) as PlanoEstado[];
}

export function resumenListos(planos: PlanoEstado[], hayManifiesto: boolean): Listos {
	if (!planos.length) return hayManifiesto ? 'sin_enviar' : 'sin_planos';
	if (planos.some((x) => x.decision === 'rechazado')) return 'cambios';
	if (planos.some((x) => !x.decision)) return 'pendientes';
	return 'listos';
}

export const MOTIVO_NO_PUBLICAR: Record<Exclude<Listos, 'listos' | 'sin_planos'>, string> = {
	sin_enviar: 'Primero envía los planos a la promotora para que los valide.',
	pendientes: 'Faltan planos por aprobar: se podrá publicar cuando la promotora los apruebe todos.',
	cambios: 'La promotora ha pedido cambios en algún plano: hay que corregirlo y preparar una versión nueva.',
};

async function huella(datos: ArrayBuffer): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', datos))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Copia los planos de la vista previa al almacén «entregables» y los apunta para la promotora. */
async function enviar(revision: string, id: string, m: Manifiesto, progreso: (t: string) => void): Promise<void> {
	const filas = [];
	for (const [i, p] of m.planos.entries()) {
		progreso(`Copiando ${p.titulo} (${i + 1} de ${m.planos.length})…`);
		const base = `${revision}/${encodeURIComponent(id)}/planos/`;
		const [pdf, png] = await Promise.all([p.pdf, p.miniatura].map(async (f) => {
			const r = await fetch(base + encodeURIComponent(f), { cache: 'no-store' });
			if (!r.ok) throw new Error(`No se ha podido leer ${f} de la vista previa (${r.status})`);
			return r.arrayBuffer();
		}));
		if ((await huella(pdf)) !== p.huella) throw new Error(`El plano «${p.titulo}» de la vista previa no coincide con su huella. Vuelve a preparar la versión.`);
		const ruta = `${id}/${m.version}/${p.clave}.pdf`;
		const miniatura = `${id}/${m.version}/${p.clave}.png`;
		for (const [r, datos, tipo] of [[ruta, pdf, 'application/pdf'], [miniatura, png, 'image/png']] as const) {
			const { error } = await sb.storage.from('entregables').upload(r, datos, { contentType: tipo });
			// si ya estaba (un envío anterior que se cortó), se reutiliza: la huella se comprueba al aprobar
			if (error && !/exists|duplicate/i.test(error.message)) throw error;
		}
		filas.push({
			promocion_id: id, version: m.version, tipo: 'plano', tipologia: p.clave, nombre: `${p.titulo}.pdf`, ruta, huella: p.huella,
			clave: p.clave, titulo: p.titulo, detalle: p.detalle, viviendas: p.viviendas, orden: p.orden, miniatura, huella_datos: p.huellaDatos,
		});
	}
	progreso('Apuntando los planos…');
	const { error } = await sb.from('entregables').insert(filas);
	if (error) throw error;
	// la promoción pasa a «Planos para validar» en el portal
	await sb.from('promociones').update({ estado: 'en_validacion' }).eq('id', id);
	await anotar('envía los planos a la promotora', { promocion: id, version: m.version, planos: filas.length });
}

function chip(p: PlanoEstado): string {
	if (p.decision === 'aprobado') return `<span class="estado al-dia">${p.heredada_de ? `Aprobado en ${esc(p.heredada_de)}` : 'Aprobado'}</span>`;
	if (p.decision === 'rechazado') return '<span class="estado rechazado">Cambios pedidos</span>';
	return '<span class="estado pendiente">Pendiente de validar</span>';
}

/**
 * Bloque «Planos de vN» dentro de Versiones: enviar a la promotora o ver cómo
 * va la validación. Llama a alCambiar cuando cambia algo (para repintar).
 */
/** Frase que se muestra una vez, al repintar tras enviar los planos. */
let trasEnviar = '';

export function pintarPlanos(caja: HTMLElement, revision: string, id: string, version: string, m: Manifiesto | null, planos: PlanoEstado[], alCambiar: () => void): void {
	if (!m && !planos.length) {
		caja.innerHTML = '';
		return;
	}
	if (!planos.length && m) {
		caja.innerHTML = `
			<h3 class="subtitulo">Planos de ${esc(version)} para la promotora</h3>
			<p class="ayuda">Se han generado ${m.planos.length} plano(s): ${m.planos.map((p) => esc(p.titulo)).join(', ')}.
				Revisa la vista previa y, si está bien, envíaselos para que los valide en su portal. Hasta entonces no los ve.</p>
			<div class="acciones"><button class="boton" type="button" data-enviar-planos>Enviar los planos a la promotora</button></div>
			<p class="aviso" data-progreso-planos role="status" hidden></p>`;
		const b = caja.querySelector<HTMLButtonElement>('[data-enviar-planos]')!;
		const aviso = caja.querySelector<HTMLElement>('[data-progreso-planos]')!;
		b.addEventListener('click', async () => {
			if (!confirm(`¿Enviar los ${m.planos.length} planos de ${version} a la promotora?\n\nHazlo después de revisar la vista previa: la promotora los verá en su portal para aprobarlos.`)) return;
			b.disabled = true;
			aviso.hidden = false;
			aviso.classList.remove('error');
			try {
				await enviar(revision, id, m, (t) => { aviso.textContent = t; });
				aviso.textContent = 'Avisando a la promotora por email…';
				trasEnviar = `✓ Planos enviados. ${await avisarPromotora({ tipo: 'planos', promocion: id, version })}`;
				alCambiar();
			} catch (e) {
				aviso.classList.add('error');
				aviso.textContent = traducir(e);
				b.disabled = false;
			}
		});
		return;
	}

	const mensaje = trasEnviar;
	trasEnviar = '';
	const aprobados = planos.filter((p) => p.decision === 'aprobado').length;
	caja.innerHTML = `
		<h3 class="subtitulo">Planos de ${esc(version)} · ${aprobados} de ${planos.length} aprobados</h3>
		${mensaje ? `<p class="aviso" role="status">${esc(mensaje)}</p>` : ''}
		<div class="lista-planos">${planos.map((p) => `
			<div class="fila-plano">
				<span><strong>${esc(p.titulo)}</strong><br><span class="promo-lugar">${esc(p.detalle ?? '')}${p.viviendas ? ` · ${esc(p.viviendas)}` : ''}</span>
					${p.decision ? `<br><span class="promo-lugar">${p.decision === 'aprobado' ? 'Aprobado' : 'Cambios pedidos'} por ${esc(p.persona ?? '—')} el ${esc(fecha(p.momento!))}${p.heredada_de ? ` (en ${esc(p.heredada_de)}; no ha cambiado)` : ''}</span>` : ''}
					${p.decision === 'rechazado' && p.comentario ? `<span class="nota-plano">«${esc(p.comentario)}»</span>` : ''}</span>
				<span class="acciones">${chip(p)}<button class="enlace" type="button" data-ver-plano="${esc(p.ruta)}">Ver PDF</button></span>
			</div>`).join('')}</div>`;
	caja.querySelectorAll<HTMLButtonElement>('[data-ver-plano]').forEach((b) => b.addEventListener('click', async () => {
		const ventana = window.open('about:blank', '_blank');
		if (ventana) ventana.opener = null;
		const { data, error } = await sb.storage.from('entregables').createSignedUrl(b.dataset.verPlano!, 300);
		if (error || !data) { ventana?.close(); alert(traducir(error)); return; }
		if (ventana) ventana.location.href = data.signedUrl;
	}));
}
