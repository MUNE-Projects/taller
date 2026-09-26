// Panel "Personalizar vivienda": se genera a partir del catálogo de opciones.

import type { Configurador } from './configurador';
import { fmtEuros, fmtPrecio } from './configurador';

const h = ( tag: string, attrs: Record<string, string> = {}, ...hijos: ( Node | string )[] ) => {

	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs ) ) el.setAttribute( k, v );
	el.append( ...hijos );
	return el;

};

export interface PanelCallbacks {
	elegir( categoria: string, opcion: string ): void;
	cerrar(): void;
	guardar(): void;
}

export class Panel {

	private raiz: HTMLElement;
	private informes = new Map<string, HTMLElement>();

	constructor( private conf: Configurador, private cb: PanelCallbacks ) {

		this.raiz = document.querySelector( '#configurador' ) as HTMLElement;
		const cuerpo = this.raiz.querySelector( '.opciones' ) as HTMLElement;
		for ( const c of conf.datos.categorias ) {

			const lista = h( 'div', { class: 'lista' } );
			for ( const o of c.opciones ) {

				const id = `opcion-${ c.id }-${ o.id }`;
				const input = h( 'input', { type: 'radio', name: `cat-${ c.id }`, id, value: o.id } ) as HTMLInputElement;
				input.checked = conf.seleccion[ c.id ] === o.id;
				input.addEventListener( 'change', () => input.checked && this.cb.elegir( c.id, o.id ) );
				const texto = h( 'span', { class: 'texto' }, h( 'span', { class: 'nombre' }, o.nombre ) );
				if ( o.detalle ) texto.append( h( 'span', { class: 'detalle' }, o.detalle ) );
				const muestra = o.parametros ? h( 'span', { class: 'muestra', style: `--a:${ o.parametros.claro ?? o.parametros.base ?? o.parametros.pared ?? '#ddd' };--b:${ o.parametros.oscuro ?? o.parametros.mota ?? o.parametros.suelo ?? '#ccc' }` } ) : '';
				lista.append( h( 'label', { class: 'opcion', for: id }, input, muestra, texto, h( 'span', { class: 'coste' }, fmtPrecio( o.precio ) ) ) );

			}

			const informe = h( 'ul', { class: 'informe', hidden: '' } );
			this.informes.set( c.id, informe );
			const leyenda = h( 'legend', {}, c.nombre );
			const grupo = h( 'fieldset', { class: 'categoria' }, leyenda );
			if ( c.detalle ) grupo.append( h( 'p', { class: 'detalle-cat' }, c.detalle ) );
			grupo.append( lista, informe );
			cuerpo.append( grupo );

		}

		this.marcar();
		this.raiz.querySelector( '.cerrar' )!.addEventListener( 'click', () => this.cb.cerrar() );
		this.raiz.querySelector( '.guardar' )!.addEventListener( 'click', () => this.cb.guardar() );
		this.resumen();

	}

	/** Clase .elegida en la opción marcada de cada categoría (sin depender de :has()). */
	private marcar() {

		for ( const l of this.raiz.querySelectorAll<HTMLLabelElement>( '.opcion' ) ) {

			const i = l.querySelector( 'input' ) as HTMLInputElement;
			l.classList.toggle( 'elegida', i.checked );

		}

	}

	/** Marca en el panel la selección actual (p. ej. tras restaurar una configuración). */
	sincronizar() {

		for ( const c of this.conf.datos.categorias ) {

			const el = this.raiz.querySelector<HTMLInputElement>( `#opcion-${ c.id }-${ this.conf.seleccion[ c.id ] }` );
			if ( el ) el.checked = true;

		}

		this.resumen();

	}

	/** Notas bajo una categoría (p. ej. qué ha cambiado al aplicar una distribución). */
	informe( categoria: string, lineas: string[] ) {

		const ul = this.informes.get( categoria );
		if ( ! ul ) return;
		ul.replaceChildren( ...lineas.map( ( l ) => h( 'li', {}, l ) ) );
		ul.hidden = lineas.length === 0;

	}

	resumen() {

		this.marcar();
		const c = this.conf;
		const lista = this.raiz.querySelector( '.extras' ) as HTMLElement;
		lista.replaceChildren( ...( c.extras.length
			? c.extras.map( ( x ) => h( 'li', {}, h( 'span', {}, `${ x.categoria.nombre }: ${ x.opcion.nombre }` ), h( 'span', {}, fmtPrecio( x.opcion.precio ) ) ) )
			: [ h( 'li', { class: 'vacio' }, 'Ninguna. Todas las opciones son las incluidas.' ) ] ) );
		( this.raiz.querySelector( '[data-precio="base"]' ) as HTMLElement ).textContent = fmtEuros( c.datos.precioBase );
		( this.raiz.querySelector( '[data-precio="extras"]' ) as HTMLElement ).textContent = fmtEuros( c.totalExtras );
		( this.raiz.querySelector( '[data-precio="total"]' ) as HTMLElement ).textContent = fmtEuros( c.total );
		const chip = document.querySelector( '#total-ficha' ) as HTMLElement | null;
		if ( chip ) {

			chip.hidden = c.totalExtras === 0;
			chip.textContent = `Con personalización: ${ fmtEuros( c.total ) }`;

		}

	}

}
