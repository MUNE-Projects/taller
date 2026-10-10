// Pestaña «Compradores» de una promoción (Etapa 5, 014_codigos_comprador.sql).
// El mismo archivo está en el Panel (panel/src) y en el portal (portal/src):
// si cambias uno, copia el otro.
//
// Un código por vivienda. Solo se ve al generarlo (en Supabase queda su huella);
// si se pierde, se cambia. Al cambiarlo se indica si es el mismo comprador
// (conserva lo que eligió) o uno nuevo (empieza de cero).

import type { SupabaseClient } from '@supabase/supabase-js';

interface Dependencias {
	sb: SupabaseClient;
	esc: (t: string) => string;
	fecha: (iso: string) => string;
	traducir: (e: unknown) => string;
	escaparate: string;
	revision: string;
}
interface Vivienda { ref: string; portal: string | null; planta: string; tipologia: string; espejo: boolean }
interface Codigo { vivienda_ref: string; comprador: number; creado_en: string; ultimo_acceso: string | null; accesos: number }

/** Lista pública de viviendas de la última versión preparada (o de la publicada). */
async function leerViviendas(d: Dependencias, id: string): Promise<Vivienda[] | null> {
	for (const base of [d.revision, d.escaparate]) {
		try {
			const r = await fetch(`${base}/${encodeURIComponent(id)}/viviendas.json`, { cache: 'no-store' });
			if (r.ok) return await r.json() as Vivienda[];
		} catch { /* se prueba la siguiente */ }
	}
	return null;
}

export async function pintarCompradores(caja: HTMLElement, d: Dependencias, p: { id: string; nombre: string }): Promise<void> {
	const { esc } = d;
	const [viviendas, { data, error }] = await Promise.all([leerViviendas(d, p.id), d.sb.rpc('codigos_de_promocion', { p_promocion: p.id })]);
	if (error) {
		caja.innerHTML = `<h2>Compradores</h2><p class="error">${esc(d.traducir(error))}</p>`;
		return;
	}
	const codigos = new Map(((data ?? []) as Codigo[]).map((c) => [c.vivienda_ref, c]));
	const refs = [...new Set([...(viviendas ?? []).map((v) => v.ref), ...codigos.keys()])];
	const datos = new Map((viviendas ?? []).map((v) => [v.ref, v]));

	caja.innerHTML = `
		<h2>Compradores</h2>
		<p class="ayuda">Un código por vivienda. Se lo dais al comprador (la promotora o el comercial) y con él entra en la web pública,
			en «¿Ya eres comprador? Accede para personalizar tu vivienda». El código solo se ve al generarlo: si se pierde, se cambia por otro.</p>
		<div data-codigo-nuevo></div>
		${refs.length ? `<div class="tabla"><table>
			<thead><tr><th>Vivienda</th><th>Código</th><th></th></tr></thead>
			<tbody>${refs.map((ref) => {
				const v = datos.get(ref);
				const c = codigos.get(ref);
				return `<tr data-vivienda="${esc(ref)}">
					<td><strong>${esc(ref)}</strong>${v ? `<br><span class="promo-lugar">${esc([v.portal ? `Portal ${v.portal}` : '', v.planta ? `Planta ${v.planta}` : '', `Tipología ${v.tipologia.toUpperCase()}${v.espejo ? ' (espejo)' : ''}`].filter(Boolean).join(' · '))}</span>` : ''}</td>
					<td>${c ? `<span class="estado al-dia">Con código</span><br><span class="promo-lugar">Desde el ${esc(d.fecha(c.creado_en))}${c.comprador > 1 ? ` · comprador nº ${c.comprador}` : ''}<br>${c.ultimo_acceso ? `Último acceso: ${esc(d.fecha(c.ultimo_acceso))} (${c.accesos} en total)` : 'Todavía no ha entrado'}</span>` : '<span class="estado">Sin código</span>'}</td>
					<td class="acciones-fila">${c
						? `<button class="boton secundario pequeno" type="button" data-cambiar>Cambiar código…</button>
							<div class="cambio" data-opciones hidden>
								<p class="ayuda">¿Para quién es el código nuevo? El actual dejará de valer al momento.</p>
								<button class="boton secundario pequeno" type="button" data-generar="mismo">Mismo comprador (ha perdido el código)</button>
								<button class="boton secundario pequeno" type="button" data-generar="nuevo">Comprador nuevo (empieza de cero)</button>
								<button class="enlace" type="button" data-cancelar>Cancelar</button>
							</div>`
						: '<button class="boton pequeno" type="button" data-generar="primero">Generar código</button>'}</td>
				</tr>`;
			}).join('')}</tbody></table></div>`
		: '<p class="vacio">Todavía no hay lista de viviendas: aparecerá cuando MUNE prepare la primera versión de la promoción.</p>'}`;

	caja.querySelectorAll<HTMLTableRowElement>('tr[data-vivienda]').forEach((fila) => {
		const opciones = fila.querySelector<HTMLElement>('[data-opciones]');
		const cambiar = fila.querySelector<HTMLButtonElement>('[data-cambiar]');
		cambiar?.addEventListener('click', () => { opciones!.hidden = false; cambiar.hidden = true; });
		fila.querySelector('[data-cancelar]')?.addEventListener('click', () => { opciones!.hidden = true; cambiar!.hidden = false; });
		fila.querySelectorAll<HTMLButtonElement>('[data-generar]').forEach((b) => b.addEventListener('click', async () => {
			const ref = fila.dataset.vivienda!;
			const tipo = b.dataset.generar!;
			if (tipo === 'nuevo' && !confirm(`¿Código para un comprador nuevo de ${ref}?\n\nEl comprador nuevo empieza de cero: no verá nada de lo que eligió el anterior (queda en el historial). El código actual dejará de valer.`)) return;
			b.disabled = true;
			const { data: codigo, error: e } = await d.sb.rpc('generar_codigo_comprador', { p_promocion: p.id, p_vivienda: ref, p_nuevo_comprador: tipo === 'nuevo' });
			if (e || typeof codigo !== 'string') { b.disabled = false; alert(d.traducir(e)); return; }
			await pintarCompradores(caja, d, p);
			mostrarCodigo(caja.querySelector<HTMLElement>('[data-codigo-nuevo]')!, d, p, ref, codigo);
		}));
	});
}

/** El código recién generado: se ve solo esta vez. */
function mostrarCodigo(destino: HTMLElement, d: Dependencias, p: { id: string; nombre: string }, ref: string, codigo: string): void {
	const { esc } = d;
	const enlace = `${d.escaparate}/${p.id}/#${codigo}`;
	const mensaje = `Hola: este es tu código de comprador de ${p.nombre} (vivienda ${ref}): ${codigo}\n\n`
		+ `Entra en ${d.escaparate}/${p.id}/ y pulsa «¿Ya eres comprador? Accede para personalizar tu vivienda», o abre directamente este enlace: ${enlace}\n\n`
		+ 'Guárdalo: es personal y sirve para ver y personalizar tu vivienda.';
	destino.innerHTML = `<div class="codigo-nuevo" role="status">
		<p><strong>Código de ${esc(ref)}</strong> · apúntalo o cópialo ahora: no se podrá volver a ver.</p>
		<p class="codigo">${esc(codigo)}</p>
		<p class="promo-lugar">Enlace directo: ${esc(enlace)}</p>
		<div class="acciones">
			<button class="boton pequeno" type="button" data-copiar="codigo">Copiar código</button>
			<button class="boton secundario pequeno" type="button" data-copiar="mensaje">Copiar mensaje para el comprador</button>
			<button class="enlace" type="button" data-cerrar-codigo>Ya lo tengo</button>
		</div>
	</div>`;
	destino.querySelectorAll<HTMLButtonElement>('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(b.dataset.copiar === 'codigo' ? codigo : mensaje);
			b.textContent = '✓ Copiado';
		} catch {
			alert(b.dataset.copiar === 'codigo' ? codigo : mensaje);
		}
	}));
	destino.querySelector('[data-cerrar-codigo]')!.addEventListener('click', () => { destino.innerHTML = ''; });
	destino.scrollIntoView({ block: 'nearest' });
}
