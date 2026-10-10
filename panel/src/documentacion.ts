// Pestaña «Documentación» de una promoción (Etapa 3 · recetas 2 y 13).
//
// · Lo que ha subido la promotora, documento a documento y con todas sus
//   versiones: descargar, marcar como vigente o rechazar con una nota (la
//   promotora ve el estado y la nota en su portal).
// · La lista de documentos que tiene que entregar, que se puede ajustar.
//
// Las reglas (005, 008) dejan a la administradora cambiar solo el estado y la
// nota; nadie puede borrar ni sobrescribir un documento.

import { avisarPromotora } from './avisos';
import { alEnviar, anotar, conectarPlegables, esc, fecha, sb, traducir } from './comun';

interface PromocionMin { id: string; nombre: string; promotora_id: string }
interface Requisito { id: number; bloque: string; elemento: string; descripcion: string; obligatorio: boolean; activo: boolean }
interface Documento {
	id: number; requisito_id: number; nombre: string; ruta: string; tamano: number; version: number;
	estado: string; nota: string | null; subido_por: string; subido_en: string; revisado_en: string | null;
}

const BLOQUES = ['Planos', 'Memoria de calidades', 'Superficies', 'Marca', 'Datos legales', 'Personalización'];
const ESTADOS_DOC: Record<string, [string, string]> = {
	pendiente: ['Por revisar', 'pendiente'],
	vigente: ['Vigente', 'al-dia'],
	rechazado: ['Rechazado', 'rechazado'],
};

function tamano(bytes: number): string {
	return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Descarga con un enlace temporal de 1 minuto. */
async function descargar(ruta: string, nombre: string, promocion: string): Promise<void> {
	const { data, error } = await sb.storage.from('documentos').createSignedUrl(ruta, 60, { download: nombre });
	if (error) { alert(traducir(error)); return; }
	void anotar('descarga un documento', { promocion, nombre });
	const a = document.createElement('a');
	a.href = data.signedUrl;
	a.rel = 'noopener';
	a.click();
}

export async function pintarDocumentacion(caja: HTMLElement, p: PromocionMin): Promise<void> {
	const [reqs, docs, personas] = await Promise.all([
		sb.from('requisitos').select('id, bloque, elemento, descripcion, obligatorio, activo').eq('promocion_id', p.id).order('orden').order('id'),
		sb.from('documentos').select('id, requisito_id, nombre, ruta, tamano, version, estado, nota, subido_por, subido_en, revisado_en')
			.eq('promocion_id', p.id).order('version', { ascending: false }),
		sb.from('miembros').select('user_id, nombre').eq('promotora_id', p.promotora_id),
	]);
	for (const r of [reqs, docs, personas]) if (r.error) throw r.error;
	const requisitos = (reqs.data ?? []) as Requisito[];
	const documentos = (docs.data ?? []) as Documento[];
	const quien = new Map(((personas.data ?? []) as { user_id: string; nombre: string }[]).map((x) => [x.user_id, x.nombre]));
	const ultimo = (r: Requisito) => documentos.find((d) => d.requisito_id === r.id);
	const recargar = () => pintarDocumentacion(caja, p);

	const activos = requisitos.filter((r) => r.activo);
	const obligatorios = activos.filter((r) => r.obligatorio);
	const entregados = obligatorios.filter((r) => ultimo(r) && ultimo(r)!.estado !== 'rechazado').length;
	const porRevisar = activos.filter((r) => ultimo(r)?.estado === 'pendiente').length;
	const vigentes = activos.filter((r) => ultimo(r)?.estado === 'vigente').length;

	const bloques = new Map<string, Requisito[]>();
	for (const r of activos) bloques.set(r.bloque, [...(bloques.get(r.bloque) ?? []), r]);

	caja.innerHTML = `
		<h2>Documentación</h2>
		<p class="resumen-docs">
			<span class="estado ${entregados === obligatorios.length && obligatorios.length ? 'al-dia' : 'pendiente'}">Obligatorios entregados: ${entregados} de ${obligatorios.length}</span>
			<span class="estado ${porRevisar ? 'pendiente' : ''}">Por revisar: ${porRevisar}</span>
			<span class="estado ${vigentes ? 'al-dia' : ''}">Vigentes: ${vigentes}</span>
		</p>
		<p class="ayuda">Al marcar un documento como vigente o rechazarlo, la promotora lo ve en su portal. Si lo rechazas, explica por qué: la nota le llegará tal cual.</p>
		${[...bloques].map(([bloque, rs]) => `<div class="bloque-docs"><h3>${esc(bloque)}</h3>${rs.map((r) => {
			const versiones = documentos.filter((d) => d.requisito_id === r.id);
			const u = versiones[0];
			const [etiqueta, clase] = u ? ESTADOS_DOC[u.estado] ?? [u.estado, ''] : r.obligatorio ? ['Falta por entregar', 'pendiente'] : ['Opcional', ''];
			return `<article class="requisito-doc" data-requisito-doc="${r.id}">
				<div class="promo-cabeza">
					<span><strong>${esc(r.elemento)}</strong>${r.obligatorio ? '' : ' <span class="promo-lugar">(opcional)</span>'}</span>
					<span class="estado ${clase}">${esc(etiqueta)}</span>
				</div>
				${versiones.length ? `<div class="historial">${versiones.map((d, i) => `<div class="historial-fila">
					<span><strong>v${d.version}</strong> · ${esc(d.nombre)} · ${esc(tamano(d.tamano))} · ${esc(fecha(d.subido_en))} · ${esc(quien.get(d.subido_por) ?? '—')}
						${i > 0 || d.estado !== 'pendiente' ? ` · <span class="estado ${ESTADOS_DOC[d.estado]?.[1] ?? ''}">${esc(ESTADOS_DOC[d.estado]?.[0] ?? d.estado)}</span>` : ''}</span>
					<button class="enlace" type="button" data-bajar="${d.id}">Descargar</button>
				</div>${d.nota ? `<p class="promo-lugar nota-doc">Nota: ${esc(d.nota)}</p>` : ''}`).join('')}</div>
				<div class="acciones">
					${u!.estado !== 'vigente' ? `<button class="boton pequeno" type="button" data-vigente="${u!.id}">Marcar v${u!.version} como vigente</button>` : ''}
					${u!.estado !== 'rechazado' ? `<button class="boton secundario pequeno" type="button" data-abrir="rechazo-${u!.id}">Rechazar v${u!.version}…</button>` : ''}
				</div>
				<form class="peticion-form" data-rechazo="${u!.id}" data-plegable="rechazo-${u!.id}" hidden novalidate>
					<label>¿Por qué se rechaza? (lo verá la promotora)
						<textarea name="nota" rows="3" maxlength="2000" required placeholder="Por ejemplo: faltan las cotas de la cocina; subid el plano acotado."></textarea>
					</label>
					<p class="error" role="alert"></p>
					<div class="acciones">
						<button class="boton" type="submit">Rechazar</button>
						<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
					</div>
				</form>` : '<p class="vacio">Todavía no ha subido nada.</p>'}
			</article>`;
		}).join('')}</div>`).join('') || '<p class="vacio">La lista de documentos está vacía.</p>'}
		<div class="acciones"><button class="boton secundario pequeno" type="button" data-ajustar>Ajustar la lista de documentos</button></div>
		<div data-requisitos hidden></div>`;

	conectarPlegables(caja);
	caja.querySelectorAll<HTMLButtonElement>('[data-bajar]').forEach((b) => b.addEventListener('click', () => {
		const d = documentos.find((x) => x.id === Number(b.dataset.bajar))!;
		void descargar(d.ruta, d.nombre, p.id);
	}));
	caja.querySelectorAll<HTMLButtonElement>('[data-vigente]').forEach((b) => b.addEventListener('click', async () => {
		b.disabled = true;
		const { error } = await sb.from('documentos').update({ estado: 'vigente', nota: null }).eq('id', Number(b.dataset.vigente));
		if (error) { b.disabled = false; alert(traducir(error)); return; }
		await recargar();
	}));
	caja.querySelectorAll<HTMLFormElement>('[data-rechazo]').forEach((form) => alEnviar(form, async (d) => {
		const nota = String(d.get('nota')).trim();
		if (nota.length < 5) throw new Error('Explica por qué se rechaza, para que la promotora sepa qué corregir.');
		const { error } = await sb.from('documentos').update({ estado: 'rechazado', nota }).eq('id', Number(form.dataset.rechazo));
		if (error) throw error;
		const aviso = await avisarPromotora({ tipo: 'rechazado', documento_id: Number(form.dataset.rechazo) });
		await recargar();
		alert(`Documento rechazado. ${aviso}`);
	}));
	const ajustar = caja.querySelector<HTMLButtonElement>('[data-ajustar]')!;
	const lista = caja.querySelector<HTMLElement>('[data-requisitos]')!;
	ajustar.addEventListener('click', () => {
		lista.hidden = !lista.hidden;
		if (!lista.hidden) void pintarRequisitos(p, lista, recargar);
	});
}

async function pintarRequisitos(p: PromocionMin, destino: HTMLElement, alCambiar: () => Promise<void>): Promise<void> {
	const { data, error } = await sb.from('requisitos').select('id, bloque, elemento, descripcion, obligatorio, activo')
		.eq('promocion_id', p.id).order('orden').order('id');
	if (error) {
		destino.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const reqs = (data ?? []) as Requisito[];
	const bloques = [...new Set([...BLOQUES, ...reqs.map((r) => r.bloque)])];
	destino.innerHTML = `<div class="requisitos">
		${reqs.length ? `<ul>${reqs.map((r) => `<li class="${r.activo ? '' : 'quitado'}"><strong>${esc(r.bloque)}</strong> · ${esc(r.elemento)}${r.obligatorio ? '' : ' <span class="promo-lugar">(opcional)</span>'}
			${r.activo ? '' : ' <span class="promo-lugar">(quitado de la lista)</span>'}
			<button class="enlace" type="button" data-requisito="${r.id}" data-activo="${r.activo}">${r.activo ? 'Quitar' : 'Volver a poner'}</button>
			${r.descripcion ? `<br><span class="promo-lugar">${esc(r.descripcion)}</span>` : ''}</li>`).join('')}</ul>` : ''}
		${reqs.some((r) => r.activo) ? '' : `<p class="vacio">La lista está vacía: la promotora no verá nada que entregar.</p>
			<div class="acciones"><button class="boton secundario pequeno" type="button" data-estandar>Añadir la lista estándar</button></div>`}
		<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="requisito">Añadir un documento a la lista</button></div>
		<form class="peticion-form" data-plegable="requisito" hidden novalidate>
			<label>Bloque <input name="bloque" list="bloques-${esc(p.id)}" maxlength="80" required placeholder="Por ejemplo: Planos"></label>
			<datalist id="bloques-${esc(p.id)}">${bloques.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
			<label>Qué tiene que entregar <input name="elemento" maxlength="120" required placeholder="Por ejemplo: Plano de planta de cada tipología (PDF o DWG)"></label>
			<label>Explicación para la promotora (opcional) <input name="descripcion" maxlength="1000"></label>
			<label class="en-linea"><input name="obligatorio" type="checkbox" checked> Obligatorio</label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton pequeno" type="submit">Añadir a la lista</button>
				<button class="boton secundario pequeno" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>
	</div>`;
	conectarPlegables(destino);
	destino.querySelectorAll<HTMLButtonElement>('[data-requisito]').forEach((b) => b.addEventListener('click', async () => {
		const activo = b.dataset.activo !== 'true';
		b.disabled = true;
		const { error: e } = await sb.from('requisitos').update({ activo }).eq('id', Number(b.dataset.requisito));
		if (e) { b.disabled = false; alert(traducir(e)); return; }
		await anotar(activo ? 'vuelve a poner un documento en la lista' : 'quita un documento de la lista', { promocion: p.id, requisito: Number(b.dataset.requisito) });
		await alCambiar();
	}));
	destino.querySelector<HTMLButtonElement>('[data-estandar]')?.addEventListener('click', async (ev) => {
		(ev.currentTarget as HTMLButtonElement).disabled = true;
		const { error: e } = await sb.rpc('aplicar_lista_estandar', { p_promocion: p.id });
		if (e) alert(traducir(e));
		await alCambiar();
	});
	alEnviar(destino.querySelector<HTMLFormElement>('form[data-plegable="requisito"]')!, async (d) => {
		const fila = {
			promocion_id: p.id,
			bloque: String(d.get('bloque')).trim(),
			elemento: String(d.get('elemento')).trim(),
			descripcion: String(d.get('descripcion')).trim(),
			obligatorio: d.get('obligatorio') === 'on',
			orden: reqs.length + 1,
		};
		if (!fila.bloque || !fila.elemento) throw new Error('Indica el bloque y qué tiene que entregar.');
		const { error: e } = await sb.from('requisitos').insert(fila);
		if (e) throw e;
		await anotar('añade un documento a la lista', { promocion: p.id, elemento: fila.elemento });
		await alCambiar();
	});
}
