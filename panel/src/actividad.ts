// Registro de actividad: de una promoción, de una promotora (con sus
// promociones) o completo (Sistema). Solo admite añadir apuntes; aquí solo se lee.

import { esc, sb, traducir } from './comun';

interface Apunte { momento: string; accion: string; user_id: string; detalle: Record<string, unknown> }

/** Textos de las acciones que anota la base de datos por su cuenta. */
const ACCIONES: Record<string, string> = {
	documento_subido: 'sube un documento',
	documento_vigente: 'marca un documento como vigente',
	documento_rechazado: 'rechaza un documento',
	documento_pendiente: 'vuelve a poner un documento en revisión',
	plano_aprobado: 'aprueba un plano',
	plano_rechazado: 'rechaza un plano',
	datos_promotora: 'guarda los datos de la promotora',
	datos_promocion: 'guarda los datos fiscales de la promoción',
	ficha_promocion: 'guarda la ficha de la promoción',
	formalizacion_promocion: 'guarda la formalización de la promoción',
	lista_estandar: 'prepara la lista estándar de documentos',
};

export interface FiltroActividad { promocion?: string; promotora?: string; promociones?: string[] }

/** Nombres de quien hace cada apunte (administradoras y personas de las promotoras). */
async function nombres(): Promise<Map<string, string>> {
	const [ad, mi] = await Promise.all([
		sb.from('administradores').select('user_id, nombre'),
		sb.from('miembros').select('user_id, nombre'),
	]);
	const mapa = new Map<string, string>();
	for (const m of (mi.data ?? []) as { user_id: string; nombre: string }[]) mapa.set(m.user_id, m.nombre);
	for (const a of (ad.data ?? []) as { user_id: string; nombre: string }[]) mapa.set(a.user_id, `${a.nombre} (tú)`);
	return mapa;
}

export async function pintarActividad(destino: HTMLElement, filtro: FiltroActividad = {}, limite = 50): Promise<void> {
	let consulta = sb.from('registro').select('momento, accion, user_id, detalle').order('momento', { ascending: false }).limit(limite);
	// Los apuntes llevan la promoción en «promocion» (los más antiguos, en «id»)
	// y la promotora en «promotora».
	const condiciones: string[] = [];
	const promociones = [...(filtro.promociones ?? []), ...(filtro.promocion ? [filtro.promocion] : [])];
	if (promociones.length) {
		const lista = promociones.map((p) => `"${p}"`).join(',');
		condiciones.push(`detalle->>promocion.in.(${lista})`, `detalle->>id.in.(${lista})`);
	}
	if (filtro.promotora) condiciones.push(`detalle->>promotora.eq.${filtro.promotora}`);
	if (condiciones.length) consulta = consulta.or(condiciones.join(','));

	const [{ data, error }, quien] = await Promise.all([consulta, nombres()]);
	if (error) {
		destino.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	// Los accesos los anota también la propia base de datos (acceso_dado y
	// acceso_cambiado), como garantía; aquí basta con el apunte del Panel, que
	// trae más detalle, para no ver cada cosa dos veces.
	const apuntes = ((data ?? []) as Apunte[]).filter((a) => a.accion !== 'acceso_dado' && a.accion !== 'acceso_cambiado');
	if (!apuntes.length) {
		destino.innerHTML = '<p class="vacio">Sin actividad todavía.</p>';
		return;
	}
	const detalle = (a: Apunte) => {
		const d = a.detalle ?? {};
		const partes = [
			!filtro.promocion && typeof d.promocion === 'string' && d.promocion !== 'todas' ? d.promocion : null,
			typeof d.email === 'string' ? d.email : null,
			typeof d.nombre === 'string' ? d.nombre : null,
			typeof d.version === 'string' ? d.version : null,
			typeof d.motivo === 'string' ? `motivo: ${d.motivo}` : null,
			typeof d.nota === 'string' ? `nota: ${d.nota}` : null,
		].filter(Boolean) as string[];
		return partes.join(' · ');
	};
	destino.innerHTML = `<div class="tabla"><table><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th></tr></thead><tbody>
		${apuntes.map((a) => `<tr>
			<td>${esc(new Date(a.momento).toLocaleString('es-ES'))}</td>
			<td>${esc(quien.get(a.user_id) ?? '—')}</td>
			<td>${esc(ACCIONES[a.accion] ?? a.accion)}${detalle(a) ? `<br><span class="promo-lugar">${esc(detalle(a))}</span>` : ''}</td>
		</tr>`).join('')}
	</tbody></table></div>`;
}
