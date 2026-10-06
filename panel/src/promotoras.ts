// Sección «Promotoras» del Panel (receta 14 · Gestionar accesos).
//
// · Promotoras: alta, datos, activar y desactivar.
// · Personas con acceso al portal: dar acceso (la función «invitar» de
//   Supabase envía el email de invitación), cambiar el rol, quitar y devolver
//   el acceso (al instante) y reenviar el email.
// · Promociones de cada promotora: alta sencilla, estado visible, activar y
//   desactivar, y la lista de documentos que tiene que entregar.
//
// Todo lo comprueban las reglas de la base de datos (005_portal.sql y
// 006_accesos.sql): solo la administradora, con el código del móvil.

import { alEnviar, anotar, esc, fecha, sb, traducir } from './comun';

interface Promotora { id: string; nombre: string; cif: string | null; activa: boolean }
interface Promocion { id: string; nombre: string; ubicacion: string; estado: string; activa: boolean; promotora_id: string }
interface Acceso {
	user_id: string; nombre: string; email: string; rol: string; activo: boolean;
	aceptada: boolean; ultima_entrada: string | null;
}
interface Requisito { id: number; bloque: string; elemento: string; descripcion: string; obligatorio: boolean }

const ESTADOS: Record<string, string> = {
	documentacion: 'Recogiendo documentación',
	en_produccion: 'En producción',
	en_validacion: 'Planos para validar',
	publicada: 'Publicada',
};
const ROLES: Record<string, string> = {
	gestor: 'Gestor: sube documentación y descarga',
	aprobador: 'Aprobador: además, aprueba o rechaza planos',
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

export async function pintarPromotoras(destino: HTMLElement): Promise<void> {
	const [pos, pcs] = await Promise.all([
		sb.from('promotoras').select('id, nombre, cif, activa').order('nombre'),
		sb.from('promociones').select('id, nombre, ubicacion, estado, activa, promotora_id').order('nombre'),
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
				<div><h3>${esc(po.nombre)}</h3><p class="promo-lugar">${po.cif ? `CIF ${esc(po.cif)} · ` : ''}${suyas.length} promoción(es)</p></div>
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
		<label>Nombre de la promotora <input name="nombre" maxlength="120" required></label>
		<label>CIF (opcional) <input name="cif" maxlength="20"></label>
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
		const cif = String(d.get('cif')).trim().toUpperCase() || null;
		if (nombre.length < 2) throw new Error('Escribe el nombre de la promotora.');
		const { data, error } = await sb.from('promotoras').insert({ nombre, cif }).select('id').single();
		if (error) throw error;
		await anotar('da de alta una promotora', { promotora: data.id, nombre });
		abiertas.add(data.id);
		await repintar();
	});
}

async function pintarDetalle(po: Promotora, promociones: Promocion[], det: HTMLElement, repintar: () => Promise<void>): Promise<void> {
	const { data, error } = await sb.rpc('accesos', { p_promotora: po.id });
	if (error) {
		det.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const accesos = (data ?? []) as Acceso[];

	const estadoAcceso = (a: Acceso) => !a.activo ? ['Sin acceso', '']
		: !a.aceptada ? ['Invitación enviada', 'pendiente']
		: a.ultima_entrada ? [`Entró el ${fecha(a.ultima_entrada)}`, 'al-dia']
		: ['Activa, aún no ha entrado', 'al-dia'];

	det.innerHTML = `
		<h4>Personas con acceso al portal</h4>
		${accesos.length ? `<div class="tabla"><table><thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>
			${accesos.map((a) => {
				const [estado, clase] = estadoAcceso(a);
				return `<tr data-persona="${esc(a.user_id)}">
					<td>${esc(a.nombre)}<br><span class="promo-lugar">${esc(a.email)}</span></td>
					<td><select data-rol aria-label="Rol de ${esc(a.nombre)}" ${a.activo ? '' : 'disabled'}>
						${Object.keys(ROLES).map((r) => `<option value="${r}" ${a.rol === r ? 'selected' : ''}>${r === 'gestor' ? 'Gestor' : 'Aprobador'}</option>`).join('')}
					</select></td>
					<td><span class="estado ${clase}">${esc(estado)}</span></td>
					<td><div class="acciones">
						${a.activo ? `<button class="boton secundario pequeno" type="button" data-reenviar>Reenviar email</button>
							<button class="boton secundario pequeno" type="button" data-quitar>Quitar acceso</button>`
							: '<button class="boton secundario pequeno" type="button" data-devolver>Devolver acceso</button>'}
					</div></td>
				</tr>`;
			}).join('')}
		</tbody></table></div>` : '<p class="vacio">Nadie tiene acceso todavía.</p>'}
		<p class="aviso" data-aviso-accesos role="status" hidden></p>
		${po.activa ? '<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="acceso">Dar acceso a una persona</button></div>' : ''}
		<form class="peticion-form" data-dar-acceso data-plegable="acceso" novalidate hidden>
			<p class="ayuda">Le llegará un email para elegir su contraseña y entrar en el portal.</p>
			<label>Nombre <input name="nombre" maxlength="120" required></label>
			<label>Correo <input name="email" type="email" maxlength="200" required></label>
			<label>Rol <select name="rol">${Object.entries(ROLES).map(([r, t]) => `<option value="${r}">${esc(t)}</option>`).join('')}</select></label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Dar acceso</button>
				<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>

		<h4>Promociones</h4>
		${promociones.map((p) => `<div class="sub-promo" data-promocion="${esc(p.id)}">
			<div class="promo-cabeza">
				<div><strong>${esc(p.nombre)}</strong><br><span class="promo-lugar">${esc(p.ubicacion)}${p.ubicacion ? ' · ' : ''}${esc(p.id)}</span></div>
				<span class="estado ${p.activa ? 'al-dia' : ''}">${p.activa ? 'Visible para la promotora' : 'Desactivada'}</span>
			</div>
			<div class="acciones">
				<label class="en-linea">Estado que ve la promotora
					<select data-estado-promo>${Object.entries(ESTADOS).map(([e, t]) => `<option value="${e}" ${p.estado === e ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
				</label>
			</div>
			<div class="acciones">
				<button class="boton secundario pequeno" type="button" data-requisitos>Documentos que debe entregar</button>
				<button class="boton secundario pequeno" type="button" data-activa-promo>${p.activa ? 'Desactivar' : 'Activar'}</button>
			</div>
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

		<h4>Datos de la promotora</h4>
		<div class="acciones">
			<button class="boton secundario pequeno" type="button" data-abrir="datos">Cambiar nombre o CIF</button>
			<button class="boton secundario pequeno" type="button" data-activa-promotora>${po.activa ? 'Desactivar promotora' : 'Activar promotora'}</button>
		</div>
		<form class="peticion-form" data-datos data-plegable="datos" novalidate hidden>
			<label>Nombre <input name="nombre" maxlength="120" required value="${esc(po.nombre)}"></label>
			<label>CIF <input name="cif" maxlength="20" value="${esc(po.cif ?? '')}"></label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Guardar datos</button>
				<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>`;

	// Formularios plegados: se abren con su botón y se cierran con «Cancelar».
	det.querySelectorAll<HTMLButtonElement>('[data-abrir]').forEach((b) => {
		const form = det.querySelector<HTMLFormElement>(`[data-plegable="${b.dataset.abrir}"]`)!;
		b.addEventListener('click', () => { form.hidden = false; b.hidden = true; form.querySelector('input')?.focus(); });
		form.querySelector('[data-cerrar]')!.addEventListener('click', () => { form.hidden = true; form.reset(); b.hidden = false; });
	});

	const aviso = det.querySelector<HTMLElement>('[data-aviso-accesos]')!;
	const avisar = (texto: string, esError = false) => {
		aviso.hidden = false;
		aviso.classList.toggle('error', esError);
		aviso.textContent = texto;
	};

	// Personas
	det.querySelectorAll<HTMLTableRowElement>('tr[data-persona]').forEach((fila) => {
		const userId = fila.dataset.persona!;
		const a = accesos.find((x) => x.user_id === userId)!;
		const cambiar = async (cambios: Partial<Pick<Acceso, 'rol' | 'activo'>>, accion: string) => {
			const { error } = await sb.from('miembros').update(cambios).eq('promotora_id', po.id).eq('user_id', userId);
			if (error) throw error;
			await anotar(accion, { promotora: po.id, email: a.email, ...cambios });
		};
		fila.querySelector<HTMLSelectElement>('[data-rol]')?.addEventListener('change', async (ev) => {
			const sel = ev.target as HTMLSelectElement;
			try {
				await cambiar({ rol: sel.value }, 'cambia el rol de un acceso');
				avisar(`${a.nombre} ahora es ${sel.value === 'gestor' ? 'gestor' : 'aprobador'}.`);
			} catch (e) {
				sel.value = a.rol;
				avisar(traducir(e), true);
			}
		});
		fila.querySelector('[data-quitar]')?.addEventListener('click', async () => {
			if (!confirm(`¿Quitar el acceso de ${a.nombre}?\n\nDejará de ver el portal al instante. Se puede devolver más tarde.`)) return;
			try { await cambiar({ activo: false }, 'quita un acceso'); await pintarDetalle(po, promociones, det, repintar); } catch (e) { avisar(traducir(e), true); }
		});
		fila.querySelector('[data-devolver]')?.addEventListener('click', async () => {
			try { await cambiar({ activo: true }, 'devuelve un acceso'); await pintarDetalle(po, promociones, det, repintar); } catch (e) { avisar(traducir(e), true); }
		});
		fila.querySelector<HTMLButtonElement>('[data-reenviar]')?.addEventListener('click', async (ev) => {
			const b = ev.target as HTMLButtonElement;
			b.disabled = true;
			const { data: r, error } = await sb.functions.invoke('invitar', { body: { accion: 'reenviar', promotora_id: po.id, user_id: userId } });
			b.disabled = false;
			if (error) avisar(traducir(await errorDeFuncion(error)), true);
			else avisar(r.mensaje);
		});
	});

	alEnviar(det.querySelector<HTMLFormElement>('[data-dar-acceso]')!, async (d) => {
		const { data: r, error } = await sb.functions.invoke('invitar', {
			body: { accion: 'invitar', promotora_id: po.id, nombre: String(d.get('nombre')).trim(), email: String(d.get('email')).trim(), rol: String(d.get('rol')) },
		});
		if (error) throw await errorDeFuncion(error);
		await pintarDetalle(po, promociones, det, repintar);
		det.querySelector<HTMLElement>('[data-aviso-accesos]')!.hidden = false;
		det.querySelector<HTMLElement>('[data-aviso-accesos]')!.textContent = r.mensaje;
	});

	// Promociones
	det.querySelectorAll<HTMLElement>('[data-promocion]').forEach((caja) => {
		const p = promociones.find((x) => x.id === caja.dataset.promocion)!;
		caja.querySelector<HTMLSelectElement>('[data-estado-promo]')!.addEventListener('change', async (ev) => {
			const sel = ev.target as HTMLSelectElement;
			const { error } = await sb.from('promociones').update({ estado: sel.value }).eq('id', p.id);
			if (error) { sel.value = p.estado; alert(traducir(error)); return; }
			await anotar('cambia el estado de una promoción', { promocion: p.id, estado: sel.value });
			p.estado = sel.value;
		});
		caja.querySelector('[data-activa-promo]')!.addEventListener('click', async () => {
			if (p.activa && !confirm(`¿Desactivar ${p.nombre}?\n\nLa promotora dejará de verla en su portal al instante. La web pública no cambia.`)) return;
			const { error } = await sb.from('promociones').update({ activa: !p.activa }).eq('id', p.id);
			if (error) { alert(traducir(error)); return; }
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
		const { error } = await sb.from('promociones').insert({ id, promotora_id: po.id, nombre, ubicacion: String(d.get('ubicacion')).trim() });
		if (error) throw error.code === '23505' ? new Error(`Ya existe una promoción con el identificador «${id}». Cambia un poco el nombre.`) : error;
		await anotar('da de alta una promoción', { promocion: id, promotora: po.id });
		await repintar();
	});

	// Datos
	alEnviar(det.querySelector<HTMLFormElement>('[data-datos]')!, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		if (nombre.length < 2) throw new Error('Escribe el nombre de la promotora.');
		const { error } = await sb.from('promotoras').update({ nombre, cif: String(d.get('cif')).trim().toUpperCase() || null }).eq('id', po.id);
		if (error) throw error;
		await anotar('cambia los datos de una promotora', { promotora: po.id });
		await repintar();
	});
	det.querySelector('[data-activa-promotora]')!.addEventListener('click', async () => {
		if (po.activa && !confirm(`¿Desactivar ${po.nombre}?\n\nNadie de esta promotora podrá entrar en el portal ni ver sus promociones, al instante. Las webs públicas no cambian.`)) return;
		const { error } = await sb.from('promotoras').update({ activa: !po.activa }).eq('id', po.id);
		if (error) { alert(traducir(error)); return; }
		await anotar(po.activa ? 'desactiva una promotora' : 'activa una promotora', { promotora: po.id });
		await repintar();
	});
}

async function pintarRequisitos(p: Promocion, destino: HTMLElement): Promise<void> {
	const { data, error } = await sb.from('requisitos').select('id, bloque, elemento, descripcion, obligatorio')
		.eq('promocion_id', p.id).order('orden').order('id');
	if (error) {
		destino.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const reqs = (data ?? []) as Requisito[];
	const bloques = [...new Set([...BLOQUES, ...reqs.map((r) => r.bloque)])];
	destino.innerHTML = `<div class="requisitos">
		${reqs.length ? `<ul>${reqs.map((r) => `<li><strong>${esc(r.bloque)}</strong> · ${esc(r.elemento)}${r.obligatorio ? '' : ' <span class="promo-lugar">(opcional)</span>'}
			${r.descripcion ? `<br><span class="promo-lugar">${esc(r.descripcion)}</span>` : ''}</li>`).join('')}</ul>`
			: '<p class="vacio">La lista está vacía: la promotora no verá nada que entregar.</p>'}
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
