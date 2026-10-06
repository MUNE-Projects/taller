// Promotoras y promociones del Panel (receta 14 · Gestionar accesos).
//
// · Promotoras (#/promotoras): la lista y el alta.
// · Una promotora (#/promotora/<id>): sus promociones, quién tiene acceso a
//   todas, sus datos y su actividad.
// · Una promoción (#/promocion/<id>/<pestaña>): resumen y versiones, equipo,
//   documentación, ficha y datos fiscales, peticiones de cambios y actividad.
//
// Accesos al portal: por promoción (su equipo) o a todas las promociones de la
// promotora. Sin roles: solo se apunta el cargo. Dar acceso envía el email de
// invitación (función «invitar» de Supabase); quitar y devolver es inmediato.
// Todo lo comprueban las reglas de la base de datos (005–008): solo la
// administradora, con el código del móvil.

import { pintarActividad } from './actividad';
import { alEnviar, anotar, esc, fecha, sb, traducir } from './comun';
import { pintarPeticiones } from './peticiones';
import { estadoVersiones, etiquetaVersiones, pintarVersiones } from './versiones';

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

const CAMPOS_PROMOCION = `id, nombre, ubicacion, estado, activa, promotora_id, razon_social, cif, domicilio_fiscal,
	direccion, codigo_postal, municipio, provincia, referencia_catastral, tipo, num_viviendas, num_portales, num_plantas, fecha_entrega`;

const ESTADOS: Record<string, string> = {
	documentacion: 'Recogiendo documentación',
	en_produccion: 'En producción',
	en_validacion: 'Planos para validar',
	publicada: 'Publicada',
};
const BLOQUES = ['Planos', 'Memoria de calidades', 'Superficies', 'Marca', 'Datos legales', 'Personalización'];

const PESTANAS: [string, string][] = [
	['resumen', 'Resumen y versiones'],
	['equipo', 'Equipo'],
	['documentacion', 'Documentación'],
	['ficha', 'Ficha y datos'],
	['peticiones', 'Peticiones de cambios'],
	['actividad', 'Actividad'],
];

// ── Utilidades ────────────────────────────────────────────────────────────

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

function migas(partes: [string, string | null][]): string {
	return `<nav class="migas" aria-label="Dónde estás">${partes.map(([texto, href]) =>
		href ? `<a href="${esc(href)}">${esc(texto)}</a>` : `<span>${esc(texto)}</span>`).join(' › ')}</nav>`;
}

function chipActiva(activa: boolean, si = 'Activa', no = 'Desactivada'): string {
	return `<span class="estado ${activa ? 'al-dia' : ''}">${activa ? si : no}</span>`;
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

/** «Razón social · CIF · domicilio», o aviso si no está rellenado. */
function resumenFiscal(d: DatosFiscales): string {
	const partes = [d.razon_social, d.cif ? `CIF ${d.cif}` : null, d.domicilio_fiscal].filter(Boolean) as string[];
	return partes.length ? esc(partes.join(' · ')) : '<span class="vacio">Datos fiscales sin rellenar (los rellena la promotora en su portal)</span>';
}

/** Formularios plegados: se abren con su botón y se cierran con «Cancelar». */
function conectarPlegables(raiz: HTMLElement): void {
	raiz.querySelectorAll<HTMLButtonElement>('[data-abrir]').forEach((b) => {
		const form = raiz.querySelector<HTMLFormElement>(`[data-plegable="${CSS.escape(b.dataset.abrir!)}"]`)!;
		b.addEventListener('click', () => { form.hidden = false; b.hidden = true; form.querySelector<HTMLElement>('input, textarea')?.focus(); });
		form.querySelector('[data-cerrar]')?.addEventListener('click', () => { form.hidden = true; form.reset(); b.hidden = false; });
	});
}

function avisador(raiz: HTMLElement): (texto: string, esError?: boolean) => void {
	return (texto, esError = false) => {
		const aviso = raiz.querySelector<HTMLElement>('[data-aviso]');
		if (!aviso) { alert(texto); return; }
		aviso.hidden = false;
		aviso.classList.toggle('error', esError);
		aviso.textContent = texto;
		aviso.scrollIntoView({ block: 'nearest' });
	};
}

async function leerPromotora(id: string): Promise<Promotora | null> {
	const { data, error } = await sb.from('promotoras').select('id, nombre, activa, razon_social, cif, domicilio_fiscal, contacto').eq('id', id).maybeSingle();
	if (error) throw error;
	return data as Promotora | null;
}

async function leerAccesos(promotora: string): Promise<Acceso[]> {
	const { data, error } = await sb.rpc('accesos', { p_promotora: promotora });
	if (error) throw error;
	return (data ?? []) as Acceso[];
}

// ── Personas con acceso ───────────────────────────────────────────────────

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
	return `<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="acceso">${esc(texto)}</button></div>
		<form class="peticion-form" data-dar-acceso="${esc(clave)}" data-plegable="acceso" novalidate hidden>
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

/** Botones de cada persona (quitar, devolver, reenviar) y el formulario de dar acceso. */
function conectarPersonas(raiz: HTMLElement, accesos: Acceso[], promotora: string, recargar: () => Promise<void>): void {
	const avisar = avisador(raiz);
	raiz.querySelectorAll<HTMLTableRowElement>('tr[data-acceso]').forEach((fila) => {
		const a = accesos.find((x) => x.id === Number(fila.dataset.acceso))!;
		const cambiar = async (activo: boolean) => {
			const { error } = await sb.from('miembros').update({ activo }).eq('id', a.id);
			if (error) throw error;
			await anotar(activo ? 'devuelve un acceso' : 'quita un acceso', { promotora, promocion: a.promocion_id ?? 'todas', email: a.email });
		};
		fila.querySelector('[data-quitar]')?.addEventListener('click', async () => {
			if (!confirm(`¿Quitar el acceso de ${a.nombre}?\n\nDejará de verlo al instante. Se puede devolver más tarde.`)) return;
			try { await cambiar(false); await recargar(); } catch (e) { avisar(traducir(e), true); }
		});
		fila.querySelector('[data-devolver]')?.addEventListener('click', async () => {
			try { await cambiar(true); await recargar(); } catch (e) { avisar(traducir(e), true); }
		});
		fila.querySelector<HTMLButtonElement>('[data-reenviar]')?.addEventListener('click', async (ev) => {
			const b = ev.currentTarget as HTMLButtonElement;
			b.disabled = true;
			const { data: r, error } = await sb.functions.invoke('invitar', { body: { accion: 'reenviar', promotora_id: promotora, user_id: a.user_id } });
			b.disabled = false;
			if (error) avisar(traducir(await errorDeFuncion(error)), true);
			else avisar(r.mensaje);
		});
	});
	raiz.querySelectorAll<HTMLFormElement>('[data-dar-acceso]').forEach((form) => alEnviar(form, async (d) => {
		const clave = form.dataset.darAcceso!;
		const { data: r, error } = await sb.functions.invoke('invitar', {
			body: {
				accion: 'invitar', promotora_id: promotora, promocion_id: clave === 'todas' ? null : clave,
				nombre: String(d.get('nombre')).trim(), email: String(d.get('email')).trim(), cargo: String(d.get('cargo')).trim(),
			},
		});
		if (error) throw await errorDeFuncion(error);
		await recargar();
		avisador(raiz)(r.mensaje);
	}));
}

// ── Formularios de datos ──────────────────────────────────────────────────

function formFiscal(d: DatosFiscales & { contacto?: string | null }, conContacto: boolean, plegado: boolean): string {
	return `<form class="peticion-form" data-fiscal ${plegado ? 'data-plegable="fiscal" hidden' : ''} novalidate>
		<label>Razón social <input name="razon_social" maxlength="200" value="${esc(d.razon_social ?? '')}"></label>
		<label>CIF <input name="cif" maxlength="20" value="${esc(d.cif ?? '')}"></label>
		<label>Domicilio fiscal <input name="domicilio_fiscal" maxlength="300" value="${esc(d.domicilio_fiscal ?? '')}"></label>
		${conContacto ? `<label>Contacto (persona, correo o teléfono) <input name="contacto" maxlength="300" value="${esc(d.contacto ?? '')}"></label>` : ''}
		<p class="error" role="alert"></p>
		<div class="acciones">
			<button class="boton" type="submit">Guardar datos fiscales</button>
			${plegado ? '<button class="boton secundario" type="button" data-cerrar>Cancelar</button>' : ''}
		</div>
	</form>`;
}

function formFicha(p: Ficha): string {
	const num = (n: number | null) => n === null ? '' : String(n);
	return `<form class="peticion-form" data-ficha novalidate>
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
		<div class="acciones"><button class="boton" type="submit">Guardar ficha</button></div>
		<p class="ok" data-guardado role="status"></p>
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

const camposFiscales = (d: FormData) => ({
	p_razon_social: String(d.get('razon_social')), p_cif: String(d.get('cif')), p_domicilio_fiscal: String(d.get('domicilio_fiscal')),
});

// ── #/promotoras ──────────────────────────────────────────────────────────

export async function pantallaPromotoras(destino: HTMLElement): Promise<void> {
	const [pos, pcs] = await Promise.all([
		sb.from('promotoras').select('id, nombre, activa').order('nombre'),
		sb.from('promociones').select('id, promotora_id'),
	]);
	if (pos.error || pcs.error) throw pos.error ?? pcs.error;
	const promotoras = (pos.data ?? []) as Pick<Promotora, 'id' | 'nombre' | 'activa'>[];
	const cuenta = (id: string) => (pcs.data ?? []).filter((p) => p.promotora_id === id).length;

	destino.innerHTML = `
		${migas([['Promotoras', null]])}
		<section class="tarjeta">
			<h2>Promotoras</h2>
			<div class="lista-enlaces">${promotoras.map((po) => `<a class="fila-enlace" href="#/promotora/${esc(po.id)}">
				<span><strong>${esc(po.nombre)}</strong><br><span class="promo-lugar">${cuenta(po.id)} promoción(es)</span></span>
				${chipActiva(po.activa)}
			</a>`).join('') || '<p class="vacio">Todavía no hay promotoras.</p>'}</div>
			<div class="acciones"><button class="boton secundario" type="button" data-abrir="promotora">Nueva promotora</button></div>
			<form class="peticion-form" data-plegable="promotora" data-nueva-promotora hidden novalidate>
				<label>Nombre de la promotora (marca) <input name="nombre" maxlength="120" required placeholder="Por ejemplo: Construcciones Ejemplo"></label>
				<p class="ayuda">Los datos fiscales los rellenará la promotora en su portal (también puedes hacerlo tú después).</p>
				<p class="error" role="alert"></p>
				<div class="acciones">
					<button class="boton" type="submit">Dar de alta</button>
					<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
				</div>
			</form>
		</section>`;
	conectarPlegables(destino);
	alEnviar(destino.querySelector<HTMLFormElement>('[data-nueva-promotora]')!, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		if (nombre.length < 2) throw new Error('Escribe el nombre de la promotora.');
		const { data, error } = await sb.from('promotoras').insert({ nombre }).select('id').single();
		if (error) throw error;
		await anotar('da de alta una promotora', { promotora: data.id, nombre });
		location.hash = `#/promotora/${data.id}`;
	});
}

// ── #/promotora/<id> ──────────────────────────────────────────────────────

export async function pantallaPromotora(destino: HTMLElement, id: string): Promise<void> {
	const po = await leerPromotora(id);
	if (!po) {
		destino.innerHTML = `${migas([['Promotoras', '#/promotoras'], ['No encontrada', null]])}<p class="vacio">Esa promotora no existe.</p>`;
		return;
	}
	const [{ data: pcs, error }, accesos] = await Promise.all([
		sb.from('promociones').select('id, nombre, ubicacion, estado, activa').eq('promotora_id', id).order('nombre'),
		leerAccesos(id),
	]);
	if (error) throw error;
	const promociones = (pcs ?? []) as Pick<Promocion, 'id' | 'nombre' | 'ubicacion' | 'estado' | 'activa'>[];
	const recargar = () => pantallaPromotora(destino, id);

	destino.innerHTML = `
		${migas([['Promotoras', '#/promotoras'], [po.nombre, null]])}
		<div class="cabecera"><h1>${esc(po.nombre)}</h1>${chipActiva(po.activa)}</div>
		<p class="aviso" data-aviso role="status" hidden></p>

		<section class="tarjeta">
			<h2>Promociones</h2>
			<div class="lista-enlaces">${promociones.map((p) => `<a class="fila-enlace" href="#/promocion/${esc(p.id)}">
				<span><strong>${esc(p.nombre)}</strong><br><span class="promo-lugar">${esc(p.ubicacion)}${p.ubicacion ? ' · ' : ''}${esc(ESTADOS[p.estado] ?? p.estado)}</span></span>
				<span data-version="${esc(p.id)}">${p.activa ? '' : chipActiva(false)}</span>
			</a>`).join('') || '<p class="vacio">Esta promotora no tiene promociones.</p>'}</div>
			<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="promocion">Nueva promoción</button></div>
			<form class="peticion-form" data-nueva-promocion data-plegable="promocion" novalidate hidden>
				<label>Nombre <input name="nombre" maxlength="120" required placeholder="Por ejemplo: Residencial Las Eras"></label>
				<label>Ubicación (opcional) <input name="ubicacion" maxlength="120" placeholder="Por ejemplo: Alovera (Guadalajara)"></label>
				<p class="ayuda">Se creará con la lista estándar de documentos, que luego puedes ajustar.</p>
				<p class="error" role="alert"></p>
				<div class="acciones">
					<button class="boton" type="submit">Crear promoción</button>
					<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
				</div>
			</form>
		</section>

		<section class="tarjeta">
			<h2>Acceso a todas las promociones</h2>
			<p class="ayuda">Personas que ven todas las promociones de ${esc(po.nombre)}, también las que se den de alta más adelante. El equipo de cada promoción se gestiona dentro de ella.</p>
			${tablaPersonas(accesos.filter((a) => a.promocion_id === null))}
			${po.activa ? formAcceso('todas', 'Dar acceso a todas las promociones') : ''}
		</section>

		<section class="tarjeta">
			<h2>Datos de la promotora</h2>
			<p>${resumenFiscal(po)}${po.contacto ? `<br><span class="promo-lugar">Contacto: ${esc(po.contacto)}</span>` : ''}</p>
			<div class="acciones">
				<button class="boton secundario pequeno" type="button" data-abrir="fiscal">Editar datos fiscales</button>
				<button class="boton secundario pequeno" type="button" data-abrir="nombre">Cambiar nombre</button>
				<button class="boton secundario pequeno" type="button" data-activa-promotora>${po.activa ? 'Desactivar promotora' : 'Activar promotora'}</button>
			</div>
			${formFiscal(po, true, true)}
			<form class="peticion-form" data-nombre data-plegable="nombre" novalidate hidden>
				<label>Nombre de la promotora (marca) <input name="nombre" maxlength="120" required value="${esc(po.nombre)}"></label>
				<p class="error" role="alert"></p>
				<div class="acciones">
					<button class="boton" type="submit">Guardar</button>
					<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
				</div>
			</form>
		</section>

		<section class="tarjeta">
			<h2>Actividad</h2>
			<p class="ayuda">De la promotora y de todas sus promociones.</p>
			<div data-actividad><p class="vacio">Cargando…</p></div>
		</section>`;

	conectarPlegables(destino);
	conectarPersonas(destino, accesos, id, recargar);
	void pintarActividad(destino.querySelector<HTMLElement>('[data-actividad]')!, { promotora: id, promociones: promociones.map((p) => p.id) }, 30);
	// Estado de las versiones de cada promoción, sin esperar a que cargue.
	for (const p of promociones.filter((x) => x.activa)) {
		void estadoVersiones(p.id).then((e) => {
			const hueco = destino.querySelector<HTMLElement>(`[data-version="${CSS.escape(p.id)}"]`);
			if (hueco) hueco.innerHTML = etiquetaVersiones(e);
		});
	}

	alEnviar(destino.querySelector<HTMLFormElement>('[data-nueva-promocion]')!, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		const nuevo = identificador(nombre);
		if (nombre.length < 2 || !nuevo) throw new Error('Escribe el nombre de la promoción.');
		const { error: e } = await sb.from('promociones').insert({ id: nuevo, promotora_id: id, nombre, ubicacion: String(d.get('ubicacion')).trim() });
		if (e) throw e.code === '23505' ? new Error(`Ya existe una promoción con el identificador «${nuevo}». Cambia un poco el nombre.`) : e;
		await anotar('da de alta una promoción', { promocion: nuevo, promotora: id });
		// Lista estándar de documentos, que luego se puede ajustar.
		const { error: eLista } = await sb.rpc('aplicar_lista_estandar', { p_promocion: nuevo });
		if (eLista) throw new Error(`La promoción está creada, pero no se ha podido preparar su lista de documentos: ${traducir(eLista)}`);
		location.hash = `#/promocion/${nuevo}`;
	});
	alEnviar(destino.querySelector<HTMLFormElement>('[data-fiscal]')!, async (d) => {
		const { error: e } = await sb.rpc('guardar_datos_promotora', { p_promotora: id, ...camposFiscales(d), p_contacto: String(d.get('contacto')) });
		if (e) throw e;
		await recargar();
	});
	alEnviar(destino.querySelector<HTMLFormElement>('[data-nombre]')!, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		if (nombre.length < 2) throw new Error('Escribe el nombre de la promotora.');
		const { error: e } = await sb.from('promotoras').update({ nombre }).eq('id', id);
		if (e) throw e;
		await anotar('cambia el nombre de una promotora', { promotora: id, nombre });
		await recargar();
	});
	destino.querySelector('[data-activa-promotora]')!.addEventListener('click', async () => {
		if (po.activa && !confirm(`¿Desactivar ${po.nombre}?\n\nNadie de esta promotora podrá entrar en el portal ni ver sus promociones, al instante. Las webs públicas no cambian.`)) return;
		const { error: e } = await sb.from('promotoras').update({ activa: !po.activa }).eq('id', id);
		if (e) { avisador(destino)(traducir(e), true); return; }
		await anotar(po.activa ? 'desactiva una promotora' : 'activa una promotora', { promotora: id });
		await recargar();
	});
}

// ── #/promocion/<id>/<pestaña> ────────────────────────────────────────────

export async function pantallaPromocion(destino: HTMLElement, id: string, pestana: string): Promise<void> {
	const { data, error } = await sb.from('promociones').select(CAMPOS_PROMOCION).eq('id', id).maybeSingle();
	if (error) throw error;
	const p = data as Promocion | null;
	if (!p) {
		destino.innerHTML = `${migas([['Promotoras', '#/promotoras'], ['No encontrada', null]])}<p class="vacio">Esa promoción no existe.</p>`;
		return;
	}
	const po = await leerPromotora(p.promotora_id);
	const actual = PESTANAS.some(([k]) => k === pestana) ? pestana : 'resumen';

	destino.innerHTML = `
		${migas([['Promotoras', '#/promotoras'], [po?.nombre ?? '—', `#/promotora/${p.promotora_id}`], [p.nombre, null]])}
		<div class="cabecera"><div><h1>${esc(p.nombre)}</h1><p class="promo-lugar">${esc(p.ubicacion)}${p.ubicacion ? ' · ' : ''}${esc(p.id)}</p></div>
			${chipActiva(p.activa, 'Visible para su equipo', 'Desactivada')}</div>
		<nav class="pestanas" aria-label="Secciones de la promoción">${PESTANAS.map(([k, t]) =>
			`<a href="#/promocion/${esc(id)}/${k}" ${k === actual ? 'aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</nav>
		<p class="aviso" data-aviso role="status" hidden></p>
		<section class="tarjeta" data-pestana><p class="vacio">Cargando…</p></section>`;
	const caja = destino.querySelector<HTMLElement>('[data-pestana]')!;
	const recargar = () => pantallaPromocion(destino, id, actual);

	if (actual === 'resumen') {
		caja.innerHTML = `
			<h2>Versiones</h2>
			<div data-versiones></div>
			<h2 class="separado">Estado</h2>
			<label class="en-linea">Estado que ve la promotora
				<select data-estado-promo>${Object.entries(ESTADOS).map(([e, t]) => `<option value="${e}" ${p.estado === e ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
			</label>
			<p class="promo-versiones">${resumenFicha(p)}</p>
			<div class="acciones">
				<button class="boton secundario pequeno" type="button" data-activa-promo>${p.activa ? 'Desactivar promoción' : 'Activar promoción'}</button>
			</div>`;
		void pintarVersiones(caja.querySelector<HTMLElement>('[data-versiones]')!, p);
		caja.querySelector<HTMLSelectElement>('[data-estado-promo]')!.addEventListener('change', async (ev) => {
			const sel = ev.target as HTMLSelectElement;
			const { error: e } = await sb.from('promociones').update({ estado: sel.value }).eq('id', id);
			if (e) { sel.value = p.estado; avisador(destino)(traducir(e), true); return; }
			await anotar('cambia el estado de una promoción', { promocion: id, estado: sel.value });
			p.estado = sel.value;
			avisador(destino)(`Estado cambiado: «${ESTADOS[sel.value]}».`);
		});
		caja.querySelector('[data-activa-promo]')!.addEventListener('click', async () => {
			if (p.activa && !confirm(`¿Desactivar ${p.nombre}?\n\nSu equipo dejará de verla en el portal al instante. La web pública no cambia.`)) return;
			const { error: e } = await sb.from('promociones').update({ activa: !p.activa }).eq('id', id);
			if (e) { avisador(destino)(traducir(e), true); return; }
			await anotar(p.activa ? 'desactiva una promoción' : 'activa una promoción', { promocion: id });
			await recargar();
		});
	}

	if (actual === 'equipo') {
		const accesos = await leerAccesos(p.promotora_id);
		const todas = accesos.filter((a) => a.promocion_id === null && a.activo);
		caja.innerHTML = `
			<h2>Equipo de la promoción</h2>
			${tablaPersonas(accesos.filter((a) => a.promocion_id === id))}
			${po?.activa ? formAcceso(id, 'Añadir persona al equipo') : '<p class="vacio">La promotora está desactivada: actívala para dar accesos.</p>'}
			<h2 class="separado">También la ven</h2>
			${todas.length ? `<p>${todas.map((a) => `${esc(a.nombre)}${a.cargo ? ` (${esc(a.cargo)})` : ''}`).join(' · ')}</p>
				<p class="ayuda">Tienen acceso a todas las promociones de ${esc(po?.nombre ?? '')}. Se gestiona en <a href="#/promotora/${esc(p.promotora_id)}">la página de la promotora</a>.</p>`
				: '<p class="vacio">Nadie más.</p>'}`;
		conectarPlegables(caja);
		conectarPersonas(caja, accesos, p.promotora_id, recargar);
	}

	if (actual === 'documentacion') {
		caja.innerHTML = `<h2>Documentos que debe entregar</h2>
			<p class="ayuda">La lista que ve la promotora en su portal. Lo que suba aparecerá aquí en la próxima etapa.</p>
			<div data-requisitos></div>`;
		await pintarRequisitos(p, caja.querySelector<HTMLElement>('[data-requisitos]')!);
	}

	if (actual === 'ficha') {
		caja.innerHTML = `
			<h2>Ficha de la promoción</h2>
			<p class="ayuda">Normalmente la rellena la promotora en su portal; aquí la puedes revisar o completar.</p>
			${formFicha(p)}
			<h2 class="separado">Datos fiscales de la promoción</h2>
			<p class="ayuda">La sociedad de esta promoción (puede ser distinta de la de la promotora).</p>
			${formFiscal(p, false, false)}
			<p class="ok" data-guardado-fiscal role="status"></p>`;
		const ficha = caja.querySelector<HTMLFormElement>('[data-ficha]')!;
		alEnviar(ficha, async (d) => {
			const { error: e } = await sb.rpc('guardar_ficha_promocion', datosFicha(id, d));
			if (e) throw e;
			ficha.querySelector<HTMLElement>('[data-guardado]')!.textContent = '✓ Ficha guardada.';
			ficha.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
		});
		const fiscal = caja.querySelector<HTMLFormElement>('[data-fiscal]')!;
		alEnviar(fiscal, async (d) => {
			const { error: e } = await sb.rpc('guardar_datos_promocion', { p_promocion: id, ...camposFiscales(d) });
			if (e) throw e;
			caja.querySelector<HTMLElement>('[data-guardado-fiscal]')!.textContent = '✓ Datos fiscales guardados.';
			fiscal.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
		});
	}

	if (actual === 'peticiones') {
		caja.innerHTML = '<h2>Peticiones de cambios</h2><div data-peticiones><p class="vacio">Cargando…</p></div>';
		const e = await estadoVersiones(id);
		await pintarPeticiones(caja.querySelector<HTMLElement>('[data-peticiones]')!, p, (e.rev ?? e.pub)?.version ?? null);
	}

	if (actual === 'actividad') {
		caja.innerHTML = '<h2>Actividad de la promoción</h2><div data-actividad><p class="vacio">Cargando…</p></div>';
		await pintarActividad(caja.querySelector<HTMLElement>('[data-actividad]')!, { promocion: id });
	}
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
		await pintarRequisitos(p, destino);
	}));
	destino.querySelector<HTMLButtonElement>('[data-estandar]')?.addEventListener('click', async (ev) => {
		(ev.currentTarget as HTMLButtonElement).disabled = true;
		const { error: e } = await sb.rpc('aplicar_lista_estandar', { p_promocion: p.id });
		if (e) alert(traducir(e));
		await pintarRequisitos(p, destino);
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
		await pintarRequisitos(p, destino);
	});
}
