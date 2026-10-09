// Portal · pestaña «Planos» de una promoción (Etapa 4).
//
// MUNE genera los planos comerciales de cada versión (uno por tipología y
// variante, o por vivienda en las unifamiliares) y, cuando la administradora ha
// revisado la versión, se los envía a la promotora. Aquí el equipo los ve, los
// descarga y los aprueba o pide cambios. Quedan registrados la persona, el
// momento y la huella del archivo exacto (011_planos.sql). Si un plano no
// cambia de una versión a otra, su aprobación anterior sigue valiendo.

import { ESCAPARATE, REVISION, alEnviar, esc, fecha, sb, traducir } from './comun';

export interface Plano {
	id: number; clave: string; titulo: string; detalle: string | null; viviendas: string | null;
	ruta: string; miniatura: string | null; decision: 'aprobado' | 'rechazado' | null;
	comentario: string | null; momento: string | null; persona: string | null; heredada_de: string | null;
}

const numVersion = (v: string) => Number(v.slice(1));

/** Versiones con planos de una promoción, de la más reciente a la más antigua. */
export async function versionesConPlanos(id: string): Promise<string[]> {
	const { data, error } = await sb.from('entregables').select('version').eq('promocion_id', id).eq('tipo', 'plano');
	if (error) throw error;
	return [...new Set((data ?? []).map((x) => x.version as string))].sort((a, b) => numVersion(b) - numVersion(a));
}

export async function leerPlanos(id: string, version: string): Promise<Plano[]> {
	const { data, error } = await sb.rpc('planos_de_version', { p_promocion: id, p_version: version });
	if (error) throw error;
	return (data ?? []) as Plano[];
}

/** Enlaces temporales (10 minutos) a las miniaturas. */
async function miniaturas(planos: Plano[]): Promise<Map<string, string>> {
	const rutas = planos.map((p) => p.miniatura).filter((r): r is string => !!r);
	if (!rutas.length) return new Map();
	const { data } = await sb.storage.from('entregables').createSignedUrls(rutas, 600);
	return new Map((data ?? []).filter((x) => x.signedUrl).map((x) => [x.path!, x.signedUrl!] as [string, string]));
}

function estado(p: Plano): string {
	if (p.decision === 'aprobado') return `<span class="estado al-dia">${p.heredada_de ? `Aprobado en la versión ${esc(p.heredada_de.slice(1))}` : 'Aprobado'}</span>`;
	if (p.decision === 'rechazado') return '<span class="estado rechazado">Cambios pedidos</span>';
	return '<span class="estado pendiente">Pendiente de validar</span>';
}

function quien(p: Plano): string {
	if (!p.decision) return '';
	const texto = p.decision === 'aprobado' ? 'Aprobado' : 'Cambios pedidos';
	return `<p class="promo-lugar">${texto} por ${esc(p.persona ?? '—')} el ${esc(fecha(p.momento!))}${p.heredada_de ? ` (en la versión ${esc(p.heredada_de.slice(1))}: este plano no ha cambiado)` : ''}</p>`;
}

const pdfBoton = (p: Plano, texto = 'Descargar PDF') =>
	`<button class="boton secundario pequeno" type="button" data-bajar="entregables" data-ruta="${esc(p.ruta)}" data-nombre="${esc(p.titulo)}.pdf">${texto}</button>`;

/** Lista de planos de una versión. */
export async function htmlLista(id: string, version: string, versiones: string[]): Promise<string> {
	const planos = await leerPlanos(id, version);
	const urls = await miniaturas(planos);
	const actual = version === versiones[0];
	const aprobados = planos.filter((p) => p.decision === 'aprobado').length;
	return `
		<h2>Planos comerciales · versión ${esc(version.slice(1))}</h2>
		${actual ? `<p class="ayuda">Hechos por MUNE a partir de los planos acotados que nos enviasteis. Revisad cada uno y aprobadlo, o pedid cambios explicando qué hay que corregir. Lo que aprobéis es lo que se publicará.</p>`
			: '<p class="ayuda">Versión anterior: solo para consulta.</p>'}
		<p class="promo-versiones">${aprobados} de ${planos.length} aprobados</p>
		<progress class="progreso" value="${aprobados}" max="${Math.max(1, planos.length)}" aria-hidden="true"></progress>
		${planos.map((p) => `<div class="plano-fila">
			${urls.get(p.miniatura ?? '') ? `<a href="#/promocion/${esc(id)}/planos/${p.id}"><img class="plano-mini" src="${esc(urls.get(p.miniatura!)!)}" alt="Miniatura del plano ${esc(p.titulo)}"></a>` : '<span class="plano-mini"></span>'}
			<div class="plano-info">
				<div class="plano-titulo"><span class="requisito-nombre">${esc(p.titulo)}</span>${estado(p)}</div>
				<p class="promo-lugar">${esc(p.detalle ?? '')}${p.viviendas ? ` · ${esc(p.viviendas)}` : ''}</p>
				${quien(p)}
				${p.decision === 'rechazado' && p.comentario ? `<p class="requisito-nota">«${esc(p.comentario)}» MUNE está preparando una versión corregida.</p>` : ''}
				<div class="acciones">
					<a class="boton ${actual && !p.decision ? '' : 'secundario'} pequeno" href="#/promocion/${esc(id)}/planos/${p.id}">${actual && !p.decision ? 'Revisar y validar' : 'Ver'}</a>
					${pdfBoton(p)}
				</div>
			</div>
		</div>`).join('')}
		${versiones.length > 1 ? `<p class="ayuda separado">Otras versiones: ${versiones.filter((v) => v !== version)
			.map((v) => `<a class="enlace" href="#/promocion/${esc(id)}/planos/${esc(v)}">versión ${esc(v.slice(1))}</a>`).join(' · ')}</p>` : ''}`;
}

/** Un plano: verlo en grande, descargarlo y aprobarlo o pedir cambios. */
export async function pintarDetalle(caja: HTMLElement, id: string, planoId: number, versiones: string[], alValidar: (mensaje: string) => void): Promise<void> {
	const { data: e, error } = await sb.from('entregables').select('version').eq('id', planoId).eq('promocion_id', id).maybeSingle();
	if (error) throw error;
	const p = e ? (await leerPlanos(id, e.version)).find((x) => x.id === planoId) : null;
	if (!e || !p) {
		caja.innerHTML = `<a class="enlace volver" href="#/promocion/${esc(id)}/planos">← Todos los planos</a><p class="vacio">Ese plano no existe.</p>`;
		return;
	}
	const urls = await miniaturas([p]);
	const actual = e.version === versiones[0];
	const puede = actual && !p.decision;
	// la visita 3D de esta versión: la publicada, o la vista previa si aún no se ha publicado
	let visita = `${REVISION}/${id}/`;
	try {
		const r = await fetch(`${ESCAPARATE}/${encodeURIComponent(id)}/version.json`, { cache: 'no-store' });
		if (r.ok && (await r.json()).version === e.version) visita = `${ESCAPARATE}/${id}/`;
	} catch { /* se queda la vista previa */ }

	caja.innerHTML = `
		<a class="enlace volver" href="#/promocion/${esc(id)}/planos${actual ? '' : `/${esc(e.version)}`}">← Todos los planos</a>
		<div class="plano-titulo separado"><h2>${esc(p.titulo)} · versión ${esc(e.version.slice(1))}</h2>${estado(p)}</div>
		<p class="promo-lugar">${esc(p.detalle ?? '')}${p.viviendas ? ` · ${esc(p.viviendas)}` : ''}</p>
		${quien(p)}
		${p.decision === 'rechazado' && p.comentario ? `<p class="requisito-nota">«${esc(p.comentario)}»</p>` : ''}
		${urls.get(p.miniatura ?? '') ? `<img class="plano-grande" src="${esc(urls.get(p.miniatura!)!)}" alt="Plano ${esc(p.titulo)}">` : ''}
		<div class="acciones">
			<button class="boton secundario pequeno" type="button" data-pantalla>Ver a pantalla completa</button>
			${pdfBoton(p)}
			<a class="boton secundario pequeno" href="${esc(visita)}" target="_blank" rel="noopener noreferrer">Ver la visita 3D de esta versión</a>
		</div>
		${puede ? `<div class="validar">
			<form class="peticion-form" data-aprobar novalidate>
				<h2>Aprobar</h2>
				<label class="casilla"><input type="checkbox" name="confirmado"> He revisado las superficies, las cotas y la distribución, y son correctas.</label>
				<p class="error" role="alert"></p>
				<div class="acciones"><button class="boton" type="submit">Aprobar este plano</button></div>
			</form>
			<form class="peticion-form" data-rechazar novalidate>
				<h2>O pedir cambios</h2>
				<label>Qué hay que corregir
					<textarea name="comentario" rows="3" maxlength="4000" placeholder="Por ejemplo: el dormitorio 2 mide 3,10 m de ancho, no 2,90."></textarea></label>
				<p class="error" role="alert"></p>
				<div class="acciones"><button class="boton secundario" type="submit">Pedir cambios</button></div>
			</form>
			<p class="ayuda">Quedará registrado quién lo aprueba, cuándo y qué archivo exacto. Si después cambia algo del plano, habrá que volver a validarlo.</p>
		</div>` : !actual ? '<p class="ayuda">Es un plano de una versión anterior: solo para consulta.</p>' : ''}`;

	caja.querySelector('[data-pantalla]')!.addEventListener('click', async () => {
		const ventana = window.open('about:blank', '_blank');
		if (ventana) ventana.opener = null;
		const { data, error: e2 } = await sb.storage.from('entregables').createSignedUrl(p.ruta, 600);
		if (e2 || !data) { ventana?.close(); alert(traducir(e2)); return; }
		if (ventana) ventana.location.href = data.signedUrl;
	});

	const validar = async (fila: Record<string, unknown>, mensaje: string) => {
		const { data: v, error: e3 } = await sb.from('validaciones').insert({ entregable_id: p.id, ...fila }).select('id').single();
		if (e3) throw e3;
		// aviso por email a MUNE (si falla, la validación ya está guardada igualmente)
		void sb.functions.invoke('aviso-subida', { body: { validacion_id: v.id } }).catch(() => undefined);
		alValidar(mensaje);
	};
	const aprobar = caja.querySelector<HTMLFormElement>('[data-aprobar]');
	if (aprobar) alEnviar(aprobar, async (d) => {
		if (!d.get('confirmado')) throw new Error('Marca la casilla para confirmar que lo has revisado.');
		if (!confirm(`¿Aprobar el plano «${p.titulo}»?\n\nNo se puede deshacer: si luego veis algo, MUNE preparará una versión nueva.`)) {
			aprobar.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
			return;
		}
		await validar({ decision: 'aprobado', confirmado: true }, `✓ Plano «${p.titulo}» aprobado.`);
	});
	const rechazar = caja.querySelector<HTMLFormElement>('[data-rechazar]');
	if (rechazar) alEnviar(rechazar, async (d) => {
		const comentario = String(d.get('comentario') ?? '').trim();
		if (comentario.length < 3) throw new Error('Explica qué hay que corregir.');
		await validar({ decision: 'rechazado', comentario }, `Hemos recibido vuestra petición de cambios en «${p.titulo}». MUNE preparará una versión corregida.`);
	});
}
