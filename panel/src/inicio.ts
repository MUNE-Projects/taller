// Inicio del Panel: lo que necesita tu atención (versiones pendientes de
// revisar y peticiones abiertas), con enlace a cada promoción. En la Etapa 6 se
// amplía con documentación nueva, planos validados y avisos del sistema.

import { esc, fecha, sb } from './comun';
import { ESTADOS_PETICION, peticionesAbiertas } from './peticiones';
import { estadoVersiones } from './versiones';

export async function pantallaInicio(destino: HTMLElement): Promise<void> {
	destino.innerHTML = `
		<section class="tarjeta">
			<h2>Versiones pendientes de tu revisión</h2>
			<div data-versiones><p class="vacio">Consultando el escaparate…</p></div>
		</section>
		<section class="tarjeta">
			<h2>Peticiones de cambios abiertas</h2>
			<p class="ayuda">Cuando quieras que Claude se ponga con ellas, díselo en Claude Code: «revisa las peticiones del Panel».</p>
			<div data-peticiones><p class="vacio">Cargando…</p></div>
		</section>
		<div class="acciones"><a class="boton secundario" href="#/promotoras">Ver todas las promotoras y promociones</a></div>`;

	const { data } = await sb.from('promociones').select('id, nombre, promotoras(nombre)').eq('activa', true).order('nombre');
	const promociones = (data ?? []) as unknown as { id: string; nombre: string; promotoras: { nombre: string } | null }[];

	void Promise.all(promociones.map(async (p) => ({ p, e: await estadoVersiones(p.id) }))).then((lista) => {
		const pendientes = lista.filter(({ e }) => e.pendiente);
		const caja = destino.querySelector<HTMLElement>('[data-versiones]');
		if (!caja) return;
		caja.innerHTML = pendientes.length ? `<div class="lista-enlaces">${pendientes.map(({ p, e }) => `
			<a class="fila-enlace" href="#/promocion/${esc(p.id)}/resumen">
				<span><strong>${esc(p.nombre)}</strong><br><span class="promo-lugar">${esc(p.promotoras?.nombre ?? '')} · ${esc(e.rev!.version)} del ${esc(fecha(e.rev!.fecha))}</span></span>
				<span class="estado pendiente">${esc(e.rev!.version)} por revisar</span>
			</a>`).join('')}</div>` : '<p class="vacio">Nada pendiente: todas las promociones están al día.</p>';
	});

	const peticiones = await peticionesAbiertas();
	const caja = destino.querySelector<HTMLElement>('[data-peticiones]');
	if (!caja) return;
	caja.innerHTML = peticiones.length ? `<div class="lista-enlaces">${peticiones.map((x) => {
		const [etiqueta, clase] = ESTADOS_PETICION[x.estado] ?? [x.estado, ''];
		return `<a class="fila-enlace" href="#/promocion/${esc(x.promocion_id)}/peticiones">
			<span><strong>${esc(x.promociones?.nombre ?? x.promocion_id)}</strong><br><span class="promo-lugar">${esc(x.texto.length > 90 ? `${x.texto.slice(0, 90)}…` : x.texto)}</span></span>
			<span class="estado ${clase}">${esc(etiqueta)}</span>
		</a>`;
	}).join('')}</div>` : '<p class="vacio">No hay peticiones abiertas.</p>';
}
