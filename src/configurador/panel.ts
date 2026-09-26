// Panel "Personalizar": cajón lateral con categorías plegables (una abierta a
// la vez). Se genera a partir del catálogo de opciones.

import type { Configurador } from './configurador';
import { fmtEuros, fmtPrecio } from './configurador';

const h = ( tag: string, attrs: Record<string, string> = {}, ...hijos: ( Node | string )[] ) => {

	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs ) ) el.setAttribute( k, v );
	el.append( ...hijos );
	return el;

};

const CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface PanelCallbacks {
	elegir( categoria: string, opcion: string ): void;
	/** Se ha desplegado una categoría (para enseñar la estancia afectada). */
	abrir( categoria: string ): void;
	/** Quitar una mejora desde el resumen: vuelve a la opción incluida. */
	quitar( categoria: string ): void;
	/** Quitar todas las mejoras (tras confirmación). */
	restablecer(): void;
	cerrar(): void;
	generar(): void;
}

const PAPELERA = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export class Panel {

	private raiz: HTMLElement;
	private informes = new Map<string, HTMLElement>();
	private elecciones = new Map<string, HTMLElement>();
	private secciones = new Map<string, HTMLElement>();

	constructor( private conf: Configurador, private cb: PanelCallbacks ) {

		this.raiz = document.querySelector( '#configurador' ) as HTMLElement;
		const cuerpo = this.raiz.querySelector( '.opciones' ) as HTMLElement;
		cuerpo.replaceChildren();
		for ( const c of conf.datos.categorias ) {

			const idCuerpo = `cat-${ c.id }`;
			const eleccion = h( 'span', { class: 'eleccion' } );
			this.elecciones.set( c.id, eleccion );
			const cabecera = h( 'button', { type: 'button', class: 'cabecera-cat', 'aria-expanded': 'false', 'aria-controls': idCuerpo },
				h( 'span', { class: 'nombre-cat' }, c.nombre ), eleccion );
			cabecera.insertAdjacentHTML( 'beforeend', CHEVRON );
			cabecera.addEventListener( 'click', () => this.desplegar( c.id ) );

			const lista = h( 'div', { class: 'lista', role: 'radiogroup', 'aria-label': c.nombre } );
			for ( const o of c.opciones ) {

				const id = `opcion-${ c.id }-${ o.id }`;
				const input = h( 'input', { type: 'radio', name: `radio-${ c.id }`, id, value: o.id } ) as HTMLInputElement;
				input.checked = conf.seleccion[ c.id ] === o.id;
				input.addEventListener( 'change', () => input.checked && this.cb.elegir( c.id, o.id ) );
				const p = o.parametros;
				const muestra = p ? h( 'span', { class: 'muestra', style: `--a:${ p.claro ?? p.base ?? p.pared ?? '#ddd' };--b:${ p.oscuro ?? p.mota ?? p.suelo ?? '#ccc' }` } ) : h( 'span', { class: 'muestra vacia' } );
				const texto = h( 'span', { class: 'texto' }, h( 'span', { class: 'nombre' }, o.nombre ) );
				if ( o.detalle ) texto.append( h( 'span', { class: 'detalle' }, o.detalle ) );
				lista.append( h( 'label', { class: 'opcion', for: id }, input, muestra, texto, h( 'span', { class: 'coste' }, fmtPrecio( o.precio ) ) ) );

			}

			const informe = h( 'ul', { class: 'informe', hidden: '' } );
			this.informes.set( c.id, informe );
			const contenido = h( 'div', { class: 'cuerpo-cat', id: idCuerpo, hidden: '' } );
			if ( c.detalle ) contenido.append( h( 'p', { class: 'detalle-cat' }, c.detalle ) );
			contenido.append( lista, informe );
			const seccion = h( 'section', { class: 'categoria' }, cabecera, contenido );
			this.secciones.set( c.id, seccion );
			cuerpo.append( seccion );

		}

		// los botones fijos del cajón se enlazan con onclick para poder recrear el panel
		const boton = ( sel: string ) => this.raiz.querySelector( sel ) as HTMLButtonElement;
		boton( '.cerrar' ).onclick = () => this.cb.cerrar();
		boton( '.generar' ).onclick = () => this.cb.generar();
		const confirmar = this.raiz.querySelector( '.confirmar-restablecer' ) as HTMLElement;
		boton( '.restablecer' ).onclick = () => {

			confirmar.hidden = false;
			( confirmar.querySelector( '.no' ) as HTMLButtonElement ).focus();

		};
		( confirmar.querySelector( '.no' ) as HTMLButtonElement ).onclick = () => ( confirmar.hidden = true );
		( confirmar.querySelector( '.si' ) as HTMLButtonElement ).onclick = () => {

			confirmar.hidden = true;
			this.cb.restablecer();

		};
		this.resumen();

	}

	/** Vacía el panel antes de crear otro (al cargar otra vivienda). */
	destruir() {

		( this.raiz.querySelector( '.opciones' ) as HTMLElement ).replaceChildren();

	}

	/** Despliega una categoría y pliega las demás (o la pliega si ya estaba abierta). */
	desplegar( id: string | null, avisar = true ) {

		for ( const [ k, s ] of this.secciones ) {

			const abrir = k === id && s.querySelector( '.cabecera-cat' )!.getAttribute( 'aria-expanded' ) !== 'true';
			s.querySelector( '.cabecera-cat' )!.setAttribute( 'aria-expanded', String( abrir ) );
			( s.querySelector( '.cuerpo-cat' ) as HTMLElement ).hidden = ! abrir;
			s.classList.toggle( 'abierta', abrir );
			if ( abrir && avisar ) this.cb.abrir( k );

		}

	}

	/** Marca la selección actual (p. ej. tras restaurar una configuración). */
	sincronizar() {

		for ( const c of this.conf.datos.categorias ) {

			const el = this.raiz.querySelector<HTMLInputElement>( `#opcion-${ c.id }-${ this.conf.seleccion[ c.id ] }` );
			if ( el ) el.checked = true;

		}

		this.resumen();

	}

	/** Notas bajo una categoría (p. ej. qué cambia con una distribución). */
	informe( categoria: string, lineas: string[] ) {

		const ul = this.informes.get( categoria );
		if ( ! ul ) return;
		ul.replaceChildren( ...lineas.map( ( l ) => h( 'li', {}, l ) ) );
		ul.hidden = lineas.length === 0;

	}

	resumen() {

		const c = this.conf;
		for ( const l of this.raiz.querySelectorAll<HTMLLabelElement>( '.opcion' ) ) l.classList.toggle( 'elegida', ( l.querySelector( 'input' ) as HTMLInputElement ).checked );
		for ( const cat of c.datos.categorias ) {

			const o = c.opcion( cat.id );
			this.elecciones.get( cat.id )!.textContent = o.precio ? `${ o.nombre } · ${ fmtPrecio( o.precio ) }` : o.nombre;
			this.secciones.get( cat.id )!.classList.toggle( 'mejorada', o.precio > 0 );

		}

		// resumen tipo carrito: cada mejora se puede quitar desde aquí
		const carrito = this.raiz.querySelector( '.carrito' ) as HTMLElement;
		carrito.replaceChildren( ...c.extras.map( ( x ) => {

			const quitar = h( 'button', { type: 'button', class: 'quitar', 'aria-label': `Quitar ${ x.categoria.nombre.toLowerCase() }: ${ x.opcion.nombre }`, title: 'Quitar esta mejora' } );
			quitar.innerHTML = PAPELERA;
			quitar.onclick = () => this.cb.quitar( x.categoria.id );
			return h( 'li', {}, h( 'span', { class: 'nombre-extra' }, h( 'span', { class: 'cat' }, x.categoria.nombre ), ` ${ x.opcion.detalle ?? x.opcion.nombre }` ),
				h( 'span', { class: 'coste' }, `+${ fmtEuros( x.opcion.precio ) }` ), quitar );

		} ) );
		carrito.hidden = c.extras.length === 0;
		const n = c.extras.length;
		( this.raiz.querySelector( '.n-mejoras' ) as HTMLElement ).textContent = n === 0 ? 'sin mejoras' : `${ n } ${ n === 1 ? 'mejora' : 'mejoras' }`;
		( this.raiz.querySelector( '[data-precio="extras"]' ) as HTMLElement ).textContent = `+${ fmtEuros( c.totalExtras ) }`;
		( this.raiz.querySelector( '[data-precio="base"]' ) as HTMLElement ).textContent = `Precio base ${ fmtEuros( c.precioBase ) }`;
		( this.raiz.querySelector( '[data-precio="total"]' ) as HTMLElement ).textContent = fmtEuros( c.total );
		( this.raiz.querySelector( '.restablecer' ) as HTMLElement ).hidden = n === 0;
		if ( n === 0 ) ( this.raiz.querySelector( '.confirmar-restablecer' ) as HTMLElement ).hidden = true;
		const chip = document.querySelector( '#total-ficha' ) as HTMLElement | null;
		if ( chip ) {

			chip.hidden = c.totalExtras === 0;
			chip.textContent = `Con tu personalización: ${ fmtEuros( c.total ) }`;

		}

	}

}
