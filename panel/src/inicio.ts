// Inicio del Panel: lo que necesita tu atención, con enlace a cada sitio.
// Arriba, los avisos del sistema (015_sistema.sql); después, las versiones
// pendientes con el estado de sus planos, la documentación por revisar y las
// peticiones abiertas.

import { esc, fecha, sb, traducir } from './comun';
import { ESTADOS_PETICION, peticionesAbiertas } from './peticiones';
import { estadoPlanos, leerManifiesto, resumenListos, type Listos } from './planos';
import { avisosSistema, pintarAvisos } from './sistema';
import { REVISION, estadoVersiones } from './versiones';

/** Qué toca hacer con una versión pendiente, según sus planos. */
const PASO: Record<Listos, [string, string, string]> = {
	sin_planos: ['Revisar y publicar', 'pendiente', 'Revisa la vista previa y publícala si está bien.'],
	sin_enviar: ['Revisar y enviar planos', 'pendiente', 'Revisa la vista previa y envía los planos a la promotora.'],
	pendientes: ['Esperando a la promotora', '', 'La promotora está validando los planos.'],
	cambios: ['Cambios pedidos', 'rechazado', 'La promotora ha pedido cambios en algún plano.'],
	listos: ['Lista para publicar', 'al-dia', 'La promotora ha aprobado todos los planos.'],
};

export async function pantallaInicio(destino: HTMLElement): Promise<void> {
	destino.innerHTML = `
		<section class="tarjeta" data-avisos hidden>
			<h2>Avisos del sistema</h2>
			<div data-lista-avisos></div>
		</section>
		<section class="tarjeta">
			<h2>Versiones pendientes</h2>
			<div data-versiones><p class="vacio">Consultando el escaparate…</p></div>
		</section>
		<section class="tarjeta">
			<h2>Documentación por revisar</h2>
			<div data-documentos><p class="vacio">Cargando…</p></div>
		</section>
		<section class="tarjeta">
			<h2>Peticiones de cambios abiertas</h2>
			<p class="ayuda">Cuando quieras que Claude se ponga con ellas, díselo en Claude Code: «revisa las peticiones del Panel».</p>
			<div data-peticiones><p class="vacio">Cargando…</p></div>
		</section>
		<p class="ayuda" data-sistema-en-orden hidden>✓ El sistema está en orden: llaves vigentes, espacio de sobra y vigilancia funcionando. <a href="#/sistema">Ver el estado</a></p>
		<div class="acciones"><a class="boton secundario" href="#/promotoras">Ver todas las promotoras y promociones</a></div>`;

	void avisosSistema().then((avisos) => {
		const caja = destino.querySelector<HTMLElement>('[data-avisos]');
		if (!caja) return;
		caja.hidden = !avisos.length;
		destino.querySelector<HTMLElement>('[data-sistema-en-orden]')!.hidden = !!avisos.length;
		caja.querySelector<HTMLElement>('[data-lista-avisos]')!.innerHTML = pintarAvisos(avisos);
	}, (e) => {
		const caja = destino.querySelector<HTMLElement>('[data-avisos]');
		if (!caja) return;
		caja.hidden = false;
		caja.querySelector<HTMLElement>('[data-lista-avisos]')!.innerHTML = `<p class="error">${esc(traducir(e))}</p>`;
	});

	const { data } = await sb.from('promociones').select('id, nombre, promotoras(nombre)').eq('activa', true).order('nombre');
	const promociones = (data ?? []) as unknown as { id: string; nombre: string; promotoras: { nombre: string } | null }[];

	void Promise.all(promociones.map(async (p) => {
		const e = await estadoVersiones(p.id);
		if (!e.pendiente) return null;
		const version = e.rev!.version;
		const [m, planos] = await Promise.all([leerManifiesto(REVISION, p.id, version), estadoPlanos(p.id, version).catch(() => [])]);
		return { p, version, fechaV: e.rev!.fecha, listos: resumenListos(planos, !!m), aprobados: planos.filter((x) => x.decision === 'aprobado').length, total: planos.length };
	})).then((lista) => {
		// Primero lo que depende de ti (publicar, enviar planos, corregir); al final lo que espera a la promotora
		const orden: Listos[] = ['listos', 'cambios', 'sin_enviar', 'sin_planos', 'pendientes'];
		const pendientes = lista.filter((x) => x !== null).sort((a, b) => orden.indexOf(a.listos) - orden.indexOf(b.listos));
		const caja = destino.querySelector<HTMLElement>('[data-versiones]');
		if (!caja) return;
		caja.innerHTML = pendientes.length ? `<div class="lista-enlaces">${pendientes.map((x) => {
			const [etiqueta, clase, texto] = PASO[x.listos];
			const cuenta = x.total && x.listos !== 'listos' ? ` (${x.aprobados} de ${x.total} planos aprobados)` : '';
			return `<a class="fila-enlace" href="#/promocion/${esc(x.p.id)}/resumen">
				<span><strong>${esc(x.p.nombre)} · ${esc(x.version)}</strong><br><span class="promo-lugar">${esc(x.p.promotoras?.nombre ?? '')} · preparada el ${esc(fecha(x.fechaV))}. ${esc(texto)}${esc(cuenta)}</span></span>
				<span class="estado ${clase}">${esc(etiqueta)}</span>
			</a>`;
		}).join('')}</div>` : '<p class="vacio">Nada pendiente: todas las promociones están al día.</p>';
	});

	void sb.from('documentos').select('id, promocion_id, requisito_id, version, subido_en, promociones(nombre)')
		.eq('estado', 'pendiente').order('subido_en', { ascending: false }).limit(200).then(({ data: docs }) => {
			const caja = destino.querySelector<HTMLElement>('[data-documentos]');
			if (!caja) return;
			// Por promoción: cuántos documentos esperan revisión y desde cuándo.
			const grupos = new Map<string, { nombre: string; n: number; ultimo: string }>();
			for (const d of (docs ?? []) as unknown as { promocion_id: string; subido_en: string; promociones: { nombre: string } | null }[]) {
				const g = grupos.get(d.promocion_id) ?? { nombre: d.promociones?.nombre ?? d.promocion_id, n: 0, ultimo: d.subido_en };
				g.n += 1;
				grupos.set(d.promocion_id, g);
			}
			caja.innerHTML = grupos.size ? `<div class="lista-enlaces">${[...grupos].map(([id, g]) => `
				<a class="fila-enlace" href="#/promocion/${esc(id)}/documentacion">
					<span><strong>${esc(g.nombre)}</strong><br><span class="promo-lugar">Última subida: ${esc(fecha(g.ultimo))}</span></span>
					<span class="estado pendiente">${g.n} por revisar</span>
				</a>`).join('')}</div>` : '<p class="vacio">No hay documentación nueva.</p>';
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
