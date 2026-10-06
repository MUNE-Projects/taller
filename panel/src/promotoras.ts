// Sección «Promotoras» del Panel (receta 14 · Gestionar accesos).
//
// · Promotoras: alta, nombre, activar y desactivar, y sus datos fiscales
//   (normalmente los rellena la propia promotora en su portal).
// · Promociones de cada promotora: alta sencilla, estado visible, activar y
//   desactivar, datos fiscales propios, su equipo y la lista de documentos que
//   tiene que entregar.
// · Accesos al portal: por promoción (su equipo) o a todas las promociones de
//   la promotora. Sin roles: todas las personas con acceso pueden hacer lo
//   mismo; solo se apunta su cargo. Dar acceso envía el email de invitación
//   (función «invitar» de Supabase); quitar y devolver el acceso es inmediato.
//
// Todo lo comprueban las reglas de la base de datos (005, 006 y 007): solo la
// administradora, con el código del móvil.

import { alEnviar, anotar, esc, fecha, sb, traducir } from './comun';

interface DatosFiscales { razon_social: string | null; cif: string | null; domicilio_fiscal: string | null }
interface Promotora extends DatosFiscales { id: string; nombre: string; activa: boolean; contacto: string | null }
interface Ficha {
	direccion: string | null; codigo_postal: string | null; municipio: string | null; provincia: string | null;
	referencia_catastral: string | null; tipo: string | null; num_viviendas: number | null; num_portales: number | null;
	num_plantas: number | null; fecha_entrega: string | null;
}
interface Promocion extends DatosFiscales, Ficha { id: string; nombre: string; ubicacion: string; estado: string; activa: boolean; promotora_id: string }
interface Acceso {
	id: number; user_id: string; promocion_id: string | null; nombre: string; email: string; cargo: string;
	activo: boolean; aceptada: boolean; ultima_entrada: string | null;
}
interface Requisito { id: number; bloque: string; elemento: string; descripcion: string; obligatorio: boolean; activo: boolean }

const ESTADOS: Record<string, string> = {
	documentacion: 'Recogiendo documentación',
	en_produccion: 'En producción',
	en_validacion: 'Planos para validar',
	publicada: 'Publicada',
};
const BLOQUES = ['Planos', 'Memoria de calidades', 'Superficies', 'Marca', 'Datos legales', 'Personalización'];

/** Promotoras abiertas («Gestionar»), para que sigan abiertas al repintar. */
const abiertas = new Set<string>();

/** Identificador de promoción a partir de su nombre: «Residencial Las Eras» → residencial-las-eras. */
function identificador(nombre: string): string {
	return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
		.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/** Error de la función «invitar», con su mensaje en español. */
async function errorDeFuncion(error: unknown): Promise<Error> {
	try {
		const cuerpo = await (error as { context?: Response }).context?.json();
		if (cuerpo?.error) return new Error(cuerpo.error);
	} catch { /* sin detalle */ }
	return error instanceof Error ? error : new Error(String(error));
}

/** Resumen de la ficha de la promoción, o aviso si no está rellenada. */
function resumenFicha(p: Ficha): string {
	const lugar = [p.direccion, [p.codigo_postal, p.municipio].filter(Boolean).join(' '), p.provincia].filter(Boolean).join(', ');
	const partes = [
		lugar,
		p.tipo ? (p.tipo === 'plurifamiliar' ? 'Plurifamiliar' : 'Unifamiliar') : null,
		p.num_viviendas ? `${p.num_viviendas} viviendas` : null,
		p.referencia_catastral ? `Ref. catastral ${p.referencia_catastral}` : null,
		p.fecha_entrega ? `Entrega prevista: ${fecha(p.fecha_entrega)}` : null,
	].filter(Boolean) as string[];
	return partes.length ? esc(partes.join(' · ')) : '<span class="vacio">Ficha sin rellenar (la rellena la promotora en su portal)</span>';
}

function formFicha(p: Promocion): string {
	const num = (n: number | null) => n === null ? '' : String(n);
	return `<form class="peticion-form" data-ficha="${esc(p.id)}" data-plegable="ficha-${esc(p.id)}" novalidate hidden>
		<label>Dirección <input name="direccion" maxlength="200" value="${esc(p.direccion ?? '')}"></label>
		<label>Código postal <input name="codigo_postal" inputmode="numeric" maxlength="5" value="${esc(p.codigo_postal ?? '')}"></label>
		<label>Municipio <input name="municipio" maxlength="120" value="${esc(p.municipio ?? '')}"></label>
		<label>Provincia <input name="provincia" maxlength="120" value="${esc(p.provincia ?? '')}"></label>
		<label>Referencia catastral <input name="referencia_catastral" maxlength="40" value="${esc(p.referencia_catastral ?? '')}"></label>
		<label>Tipo <select name="tipo"><option value="">Sin indicar</option>
			<option value="plurifamiliar" ${p.tipo === 'plurifamiliar' ? 'selected' : ''}>Plurifamiliar</option>
			<option value="unifamiliar" ${p.tipo === 'unifamiliar' ? 'selected' : ''}>Unifamiliar</option></select></label>
		<label>Número de viviendas <input name="num_viviendas" type="number" min="1" max="5000" value="${num(p.num_viviendas)}"></label>
		<label>Número de portales o bloques <input name="num_portales" type="number" min="1" max="500" value="${num(p.num_portales)}"></label>
		<label>Número de plantas <input name="num_plantas" type="number" min="1" max="100" value="${num(p.num_plantas)}"></label>
		<label>Fecha prevista de entrega (opcional) <input name="fecha_entrega" type="date" value="${esc(p.fecha_entrega ?? '')}"></label>
		<p class="error" role="alert"></p>
		<div class="acciones">
			<button class="boton" type="submit">Guardar</button>
			<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
		</div>
	</form>`;
}

/** Datos de la ficha leídos de un formulario, listos para guardar_ficha_promocion. */
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

/** «Razón social · CIF · domicilio», o aviso si no está rellenado. */
function resumenFiscal(d: DatosFiscales): string {
	const partes = [d.razon_social, d.cif ? `CIF ${d.cif}` : null, d.domicilio_fiscal].filter(Boolean) as string[];
	return partes.length ? esc(partes.join(' · ')) : '<span class="vacio">Datos fiscales sin rellenar (los rellena la promotora en su portal)</span>';
}

export async function pintarPromotoras(destino: HTMLElement): Promise<void> {
	const [pos, pcs] = await Promise.all([
		sb.from('promotoras').select('id, nombre, activa, razon_social, cif, domicilio_fiscal, contacto').order('nombre'),
		sb.from('promociones').select(`id, nombre, ubicacion, estado, activa, promotora_id, razon_social, cif, domicilio_fiscal,
			direccion, codigo_postal, municipio, provincia, referencia_catastral, tipo, num_viviendas, num_portales, num_plantas, fecha_entrega`).order('nombre'),
	]);
	if (pos.error || pcs.error) {
		destino.innerHTML = `<p class="error">${esc(traducir(pos.error ?? pcs.error))}</p>`;
		return;
	}
	const promotoras = (pos.data ?? []) as Promotora[];
	const promociones = (pcs.data ?? []) as Promocion[];

	destino.innerHTML = `${promotoras.map((po) => {
		const suyas = promociones.filter((p) => p.promotora_id === po.id);
		return `<article class="promo" data-promotora="${esc(po.id)}">
			<div class="promo-cabeza">
				<div><h3>${esc(po.nombre)}</h3><p class="promo-lugar">${suyas.length} promoción(es)</p></div>
				<span class="estado ${po.activa ? 'al-dia' : ''}">${po.activa ? 'Activa' : 'Desactivada'}</span>
			</div>
			<div class="acciones">
				<button class="boton secundario" type="button" data-gestionar="${esc(po.id)}">${abiertas.has(po.id) ? 'Cerrar' : 'Gestionar'}</button>
			</div>
			<div class="detalle" data-detalle="${esc(po.id)}" ${abiertas.has(po.id) ? '' : 'hidden'}></div>
		</article>`;
	}).join('') || '<p class="vacio">Todavía no hay promotoras.</p>'}
	<div class="acciones"><button class="boton secundario" type="button" data-nueva-promotora>Nueva promotora</button></div>
	<form class="peticion-form" data-form-promotora hidden novalidate>
		<label>Nombre de la promotora (marca) <input name="nombre" maxlength="120" required placeholder="Por ejemplo: Construcciones Ejemplo"></label>
		<p class="ayuda">Los datos fiscales los rellenará la promotora en su portal (también puedes hacerlo tú después).</p>
		<p class="error" role="alert"></p>
		<div class="acciones">
			<button class="boton" type="submit">Dar de alta</button>
			<button class="boton secundario" type="button" data-cancelar>Cancelar</button>
		</div>
	</form>`;

	const repintar = () => pintarPromotoras(destino);

	destino.querySelectorAll<HTMLButtonElement>('[data-gestionar]').forEach((b) => b.addEventListener('click', () => {
		const id = b.dataset.gestionar!;
		const det = destino.querySelector<HTMLElement>(`[data-detalle="${CSS.escape(id)}"]`)!;
		if (abiertas.has(id)) {
			abiertas.delete(id);
			det.hidden = true;
			b.textContent = 'Gestionar';
			return;
		}
		abiertas.add(id);
		det.hidden = false;
		b.textContent = 'Cerrar';
		void pintarDetalle(promotoras.find((p) => p.id === id)!, promociones.filter((p) => p.promotora_id === id), det, repintar);
	}));
	for (const id of abiertas) {
		const po = promotoras.find((p) => p.id === id);
		const det = destino.querySelector<HTMLElement>(`[data-detalle="${CSS.escape(id)}"]`);
		if (po && det) void pintarDetalle(po, promociones.filter((p) => p.promotora_id === id), det, repintar);
	}

	const boton = destino.querySelector<HTMLButtonElement>('[data-nueva-promotora]')!;
	const form = destino.querySelector<HTMLFormElement>('[data-form-promotora]')!;
	boton.addEventListener('click', () => { form.hidden = false; boton.hidden = true; form.querySelector('input')!.focus(); });
	form.querySelector('[data-cancelar]')!.addEventListener('click', () => { form.hidden = true; form.reset(); boton.hidden = false; });
	alEnviar(form, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		if (nombre.length < 2) throw new Error('Escribe el nombre de la promotora.');
		const { data, error } = await sb.from('promotoras').insert({ nombre }).select('id').single();
		if (error) throw error;
		await anotar('da de alta una promotora', { promotora: data.id, nombre });
		abiertas.add(data.id);
		await repintar();
	});
}

// ── Detalle de una promotora ──────────────────────────────────────────────

function tablaPersonas(lista: Acceso[]): string {
	if (!lista.length) return '<p class="vacio">Nadie todavía.</p>';
	const estado = (a: Acceso) => !a.activo ? ['Sin acceso', '']
		: !a.aceptada ? ['Invitación enviada', 'pendiente']
		: a.ultima_entrada ? [`Entró el ${fecha(a.ultima_entrada)}`, 'al-dia']
		: ['Activa, aún no ha entrado', 'al-dia'];
	return `<div class="tabla"><table><thead><tr><th>Persona</th><th>Cargo</th><th>Estado</th><th></th></tr></thead><tbody>
		${lista.map((a) => {
			const [texto, clase] = estado(a);
			return `<tr data-acceso="${a.id}">
				<td>${esc(a.nombre)}<br><span class="promo-lugar">${esc(a.email)}</span></td>
				<td>${esc(a.cargo || '—')}</td>
				<td><span class="estado ${clase}">${esc(texto)}</span></td>
				<td><div class="acciones">
					${a.activo ? `<button class="boton secundario pequeno" type="button" data-reenviar>Reenviar email</button>
						<button class="boton secundario pequeno" type="button" data-quitar>Quitar acceso</button>`
						: '<button class="boton secundario pequeno" type="button" data-devolver>Devolver acceso</button>'}
				</div></td>
			</tr>`;
		}).join('')}
	</tbody></table></div>`;
}

/** Botón + formulario plegado para dar acceso (a una promoción, o a todas si clave = «todas»). */
function formAcceso(clave: string, texto: string): string {
	return `<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="acceso-${esc(clave)}">${esc(texto)}</button></div>
		<form class="peticion-form" data-dar-acceso="${esc(clave)}" data-plegable="acceso-${esc(clave)}" novalidate hidden>
			<p class="ayuda">Le llegará un email para elegir su contraseña y entrar en el portal. Podrá subir documentación, aprobar o rechazar planos y descargar.</p>
			<label>Nombre <input name="nombre" maxlength="120" required></label>
			<label>Correo <input name="email" type="email" maxlength="200" required></label>
			<label>Cargo (opcional) <input name="cargo" maxlength="120" placeholder="Por ejemplo: Director comercial"></label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Dar acceso</button>
				<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>`;
}

function formFiscal(clave: string, d: DatosFiscales & { contacto?: string | null }, conContacto: boolean): string {
	return `<form class="peticion-form" data-fiscal="${esc(clave)}" data-plegable="fiscal-${esc(clave)}" novalidate hidden>
		<label>Razón social <input name="razon_social" maxlength="200" value="${esc(d.razon_social ?? '')}"></label>
		<label>CIF <input name="cif" maxlength="20" value="${esc(d.cif ?? '')}"></label>
		<label>Domicilio fiscal <input name="domicilio_fiscal" maxlength="300" value="${esc(d.domicilio_fiscal ?? '')}"></label>
		${conContacto ? `<label>Contacto (persona, correo o teléfono) <input name="contacto" maxlength="300" value="${esc(d.contacto ?? '')}"></label>` : ''}
		<p class="error" role="alert"></p>
		<div class="acciones">
			<button class="boton" type="submit">Guardar</button>
			<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
		</div>
	</form>`;
}

async function pintarDetalle(po: Promotora, promociones: Promocion[], det: HTMLElement, repintar: () => Promise<void>): Promise<void> {
	const { data, error } = await sb.rpc('accesos', { p_promotora: po.id });
	if (error) {
		det.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const accesos = (data ?? []) as Acceso[];
	const recargar = () => pintarDetalle(po, promociones, det, repintar);

	det.innerHTML = `
		<h4>Datos de la promotora</h4>
		<p>${resumenFiscal(po)}${po.contacto ? `<br><span class="promo-lugar">Contacto: ${esc(po.contacto)}</span>` : ''}</p>
		<div class="acciones">
			<button class="boton secundario pequeno" type="button" data-abrir="fiscal-promotora">Editar datos fiscales</button>
			<button class="boton secundario pequeno" type="button" data-abrir="nombre">Cambiar nombre</button>
			<button class="boton secundario pequeno" type="button" data-activa-promotora>${po.activa ? 'Desactivar promotora' : 'Activar promotora'}</button>
		</div>
		${formFiscal('promotora', po, true)}
		<form class="peticion-form" data-nombre data-plegable="nombre" novalidate hidden>
			<label>Nombre de la promotora (marca) <input name="nombre" maxlength="120" required value="${esc(po.nombre)}"></label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Guardar</button>
				<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>

		<h4>Acceso a todas las promociones</h4>
		<p class="ayuda">Personas que ven todas las promociones de ${esc(po.nombre)}, también las que se den de alta más adelante.</p>
		${tablaPersonas(accesos.filter((a) => a.promocion_id === null))}
		${po.activa ? formAcceso('todas', 'Dar acceso a todas las promociones') : ''}

		<h4>Promociones</h4>
		${promociones.map((p) => `<div class="sub-promo" data-promocion="${esc(p.id)}">
			<div class="promo-cabeza">
				<div><strong>${esc(p.nombre)}</strong><br><span class="promo-lugar">${esc(p.ubicacion)}${p.ubicacion ? ' · ' : ''}${esc(p.id)}</span></div>
				<span class="estado ${p.activa ? 'al-dia' : ''}">${p.activa ? 'Visible para su equipo' : 'Desactivada'}</span>
			</div>
			<label class="en-linea">Estado que ve la promotora
				<select data-estado-promo>${Object.entries(ESTADOS).map(([e, t]) => `<option value="${e}" ${p.estado === e ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
			</label>
			<p class="promo-versiones">${resumenFicha(p)}</p>
			<p class="promo-versiones">${resumenFiscal(p)}</p>
			<p class="etiqueta">Equipo de la promoción</p>
			${tablaPersonas(accesos.filter((a) => a.promocion_id === p.id))}
			${po.activa ? formAcceso(p.id, 'Añadir persona al equipo') : ''}
			<div class="acciones">
				<button class="boton secundario pequeno" type="button" data-requisitos>Documentos que debe entregar</button>
				<button class="boton secundario pequeno" type="button" data-abrir="ficha-${esc(p.id)}">Editar ficha</button>
				<button class="boton secundario pequeno" type="button" data-abrir="fiscal-${esc(p.id)}">Editar datos fiscales</button>
				<button class="boton secundario pequeno" type="button" data-activa-promo>${p.activa ? 'Desactivar' : 'Activar'}</button>
			</div>
			${formFicha(p)}
			${formFiscal(p.id, p, false)}
			<div data-lista-requisitos hidden></div>
		</div>`).join('') || '<p class="vacio">Esta promotora no tiene promociones.</p>'}
		<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="promocion">Nueva promoción</button></div>
		<form class="peticion-form" data-nueva-promocion data-plegable="promocion" novalidate hidden>
			<p class="ayuda">Nueva promoción de ${esc(po.nombre)}</p>
			<label>Nombre <input name="nombre" maxlength="120" required placeholder="Por ejemplo: Residencial Las Eras"></label>
			<label>Ubicación (opcional) <input name="ubicacion" maxlength="120" placeholder="Por ejemplo: Alovera (Guadalajara)"></label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Crear promoción</button>
				<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>
		<p class="aviso" data-aviso-accesos role="status" hidden></p>`;

	const aviso = det.querySelector<HTMLElement>('[data-aviso-accesos]')!;
	const avisar = (texto: string, esError = false) => {
		aviso.hidden = false;
		aviso.classList.toggle('error', esError);
		aviso.textContent = texto;
		aviso.scrollIntoView({ block: 'nearest' });
	};

	// Formularios plegados: se abren con su botón y se cierran con «Cancelar».
	det.querySelectorAll<HTMLButtonElement>('[data-abrir]').forEach((b) => {
		const form = det.querySelector<HTMLFormElement>(`[data-plegable="${CSS.escape(b.dataset.abrir!)}"]`)!;
		b.addEventListener('click', () => { form.hidden = false; b.hidden = true; form.querySelector('input')?.focus(); });
		form.querySelector('[data-cerrar]')!.addEventListener('click', () => { form.hidden = true; form.reset(); b.hidden = false; });
	});

	// Personas: quitar, devolver y reenviar
	det.querySelectorAll<HTMLTableRowElement>('tr[data-acceso]').forEach((fila) => {
		const a = accesos.find((x) => x.id === Number(fila.dataset.acceso))!;
		const cambiar = async (activo: boolean) => {
			const { error: e } = await sb.from('miembros').update({ activo }).eq('id', a.id);
			if (e) throw e;
			await anotar(activo ? 'devuelve un acceso' : 'quita un acceso', { promotora: po.id, promocion: a.promocion_id ?? 'todas', email: a.email });
		};
		fila.querySelector('[data-quitar]')?.addEventListener('click', async () => {
			if (!confirm(`¿Quitar el acceso de ${a.nombre}?\n\nDejará de verlo al instante. Se puede devolver más tarde.`)) return;
			try { await cambiar(false); await recargar(); } catch (e) { avisar(traducir(e), true); }
		});
		fila.querySelector('[data-devolver]')?.addEventListener('click', async () => {
			try { await cambiar(true); await recargar(); } catch (e) { avisar(traducir(e), true); }
		});
		fila.querySelector<HTMLButtonElement>('[data-reenviar]')?.addEventListener('click', async (ev) => {
			const b = ev.target as HTMLButtonElement;
			b.disabled = true;
			const { data: r, error: e } = await sb.functions.invoke('invitar', { body: { accion: 'reenviar', promotora_id: po.id, user_id: a.user_id } });
			b.disabled = false;
			if (e) avisar(traducir(await errorDeFuncion(e)), true);
			else avisar(r.mensaje);
		});
	});

	// Dar acceso (a todas o a una promoción)
	det.querySelectorAll<HTMLFormElement>('[data-dar-acceso]').forEach((form) => alEnviar(form, async (d) => {
		const clave = form.dataset.darAcceso!;
		const { data: r, error: e } = await sb.functions.invoke('invitar', {
			body: {
				accion: 'invitar', promotora_id: po.id, promocion_id: clave === 'todas' ? null : clave,
				nombre: String(d.get('nombre')).trim(), email: String(d.get('email')).trim(), cargo: String(d.get('cargo')).trim(),
			},
		});
		if (e) throw await errorDeFuncion(e);
		await recargar();
		const nuevo = det.querySelector<HTMLElement>('[data-aviso-accesos]')!;
		nuevo.hidden = false;
		nuevo.textContent = r.mensaje;
	}));

	// Datos fiscales (promotora y promociones)
	det.querySelectorAll<HTMLFormElement>('[data-fiscal]').forEach((form) => alEnviar(form, async (d) => {
		const clave = form.dataset.fiscal!;
		const campos = { p_razon_social: String(d.get('razon_social')), p_cif: String(d.get('cif')), p_domicilio_fiscal: String(d.get('domicilio_fiscal')) };
		const { error: e } = clave === 'promotora'
			? await sb.rpc('guardar_datos_promotora', { p_promotora: po.id, ...campos, p_contacto: String(d.get('contacto')) })
			: await sb.rpc('guardar_datos_promocion', { p_promocion: clave, ...campos });
		if (e) throw e;
		await repintar();
	}));

	// Ficha de cada promoción
	det.querySelectorAll<HTMLFormElement>('[data-ficha]').forEach((form) => alEnviar(form, async (d) => {
		const { error: e } = await sb.rpc('guardar_ficha_promocion', datosFicha(form.dataset.ficha!, d));
		if (e) throw e;
		await repintar();
	}));

	// Nombre y activar/desactivar la promotora
	alEnviar(det.querySelector<HTMLFormElement>('[data-nombre]')!, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		if (nombre.length < 2) throw new Error('Escribe el nombre de la promotora.');
		const { error: e } = await sb.from('promotoras').update({ nombre }).eq('id', po.id);
		if (e) throw e;
		await anotar('cambia el nombre de una promotora', { promotora: po.id, nombre });
		await repintar();
	});
	det.querySelector('[data-activa-promotora]')!.addEventListener('click', async () => {
		if (po.activa && !confirm(`¿Desactivar ${po.nombre}?\n\nNadie de esta promotora podrá entrar en el portal ni ver sus promociones, al instante. Las webs públicas no cambian.`)) return;
		const { error: e } = await sb.from('promotoras').update({ activa: !po.activa }).eq('id', po.id);
		if (e) { avisar(traducir(e), true); return; }
		await anotar(po.activa ? 'desactiva una promotora' : 'activa una promotora', { promotora: po.id });
		await repintar();
	});

	// Promociones
	det.querySelectorAll<HTMLElement>('[data-promocion]').forEach((caja) => {
		const p = promociones.find((x) => x.id === caja.dataset.promocion)!;
		caja.querySelector<HTMLSelectElement>('[data-estado-promo]')!.addEventListener('change', async (ev) => {
			const sel = ev.target as HTMLSelectElement;
			const { error: e } = await sb.from('promociones').update({ estado: sel.value }).eq('id', p.id);
			if (e) { sel.value = p.estado; avisar(traducir(e), true); return; }
			await anotar('cambia el estado de una promoción', { promocion: p.id, estado: sel.value });
			p.estado = sel.value;
		});
		caja.querySelector('[data-activa-promo]')!.addEventListener('click', async () => {
			if (p.activa && !confirm(`¿Desactivar ${p.nombre}?\n\nSu equipo dejará de verla en el portal al instante. La web pública no cambia.`)) return;
			const { error: e } = await sb.from('promociones').update({ activa: !p.activa }).eq('id', p.id);
			if (e) { avisar(traducir(e), true); return; }
			await anotar(p.activa ? 'desactiva una promoción' : 'activa una promoción', { promocion: p.id });
			await repintar();
		});
		const lista = caja.querySelector<HTMLElement>('[data-lista-requisitos]')!;
		caja.querySelector('[data-requisitos]')!.addEventListener('click', () => {
			lista.hidden = !lista.hidden;
			if (!lista.hidden) void pintarRequisitos(p, lista);
		});
	});

	alEnviar(det.querySelector<HTMLFormElement>('[data-nueva-promocion]')!, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		const id = identificador(nombre);
		if (nombre.length < 2 || !id) throw new Error('Escribe el nombre de la promoción.');
		const { error: e } = await sb.from('promociones').insert({ id, promotora_id: po.id, nombre, ubicacion: String(d.get('ubicacion')).trim() });
		if (e) throw e.code === '23505' ? new Error(`Ya existe una promoción con el identificador «${id}». Cambia un poco el nombre.`) : e;
		await anotar('da de alta una promoción', { promocion: id, promotora: po.id });
		// Lista estándar de documentos, que luego se puede ajustar.
		const { error: eLista } = await sb.rpc('aplicar_lista_estandar', { p_promocion: id });
		if (eLista) throw new Error(`La promoción está creada, pero no se ha podido preparar su lista de documentos: ${traducir(eLista)}`);
		await repintar();
	});
}

async function pintarRequisitos(p: Promocion, destino: HTMLElement): Promise<void> {
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
		<form class="peticion-form" novalidate>
			<label>Bloque <input name="bloque" list="bloques-${esc(p.id)}" maxlength="80" required placeholder="Por ejemplo: Planos"></label>
			<datalist id="bloques-${esc(p.id)}">${bloques.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
			<label>Qué tiene que entregar <input name="elemento" maxlength="120" required placeholder="Por ejemplo: Plano de planta de cada tipología (PDF o DWG)"></label>
			<label>Explicación para la promotora (opcional) <input name="descripcion" maxlength="1000"></label>
			<label class="en-linea"><input name="obligatorio" type="checkbox" checked> Obligatorio</label>
			<p class="error" role="alert"></p>
			<div class="acciones"><button class="boton secundario pequeno" type="submit">Añadir a la lista</button></div>
		</form>
	</div>`;
	destino.querySelectorAll<HTMLButtonElement>('[data-requisito]').forEach((b) => b.addEventListener('click', async () => {
		const activo = b.dataset.activo !== 'true';
		b.disabled = true;
		const { error: e } = await sb.from('requisitos').update({ activo }).eq('id', Number(b.dataset.requisito));
		if (e) { b.disabled = false; alert(traducir(e)); return; }
		await anotar(activo ? 'vuelve a poner un documento en la lista' : 'quita un documento de la lista', { promocion: p.id, requisito: Number(b.dataset.requisito) });
		await pintarRequisitos(p, destino);
	}));
	destino.querySelector<HTMLButtonElement>('[data-estandar]')?.addEventListener('click', async (ev) => {
		(ev.target as HTMLButtonElement).disabled = true;
		const { error: e } = await sb.rpc('aplicar_lista_estandar', { p_promocion: p.id });
		if (e) alert(traducir(e));
		await pintarRequisitos(p, destino);
	});
	alEnviar(destino.querySelector('form')!, async (d) => {
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
		await pintarRequisitos(p, destino);
	});
}
