// Estado de la configuración comercial: opción elegida por categoría, precios
// y aplicación de los acabados a los uniforms de los materiales.
//
// Las categorías y opciones vienen de src/modelo/configuracion.json; para
// añadir una variante basta con añadir una opción con sus parámetros.

import * as THREE from 'three/webgpu';
import type { Categoria, Configuracion, Opcion } from '../modelo/tipos';
import { P } from '../escena/materiales';

export type Seleccion = Record<string, string>;

/** Qué uniforms gobierna cada categoría de acabado (clave de parámetro -> uniform). */
const DESTINO: Record<string, Record<string, { value: unknown }>> = {
	suelo: P.suelo,
	cocina: P.cocina,
	encimera: P.encimera,
	banos: P.banos,
};

export const fmtEuros = ( n: number ) => `${ Math.round( n ).toString().replace( /\B(?=(\d{3})+(?!\d))/g, '.' ) } €`;
export const fmtPrecio = ( n: number ) => ( n === 0 ? 'Incluido' : `+${ fmtEuros( n ) }` );

export class Configurador {

	seleccion: Seleccion;
	private tweens: { u: { value: unknown }; desde: THREE.Color | number; hasta: THREE.Color | number; t0: number }[] = [];
	private readonly duracion = 450;

	constructor( readonly datos: Configuracion ) {

		this.seleccion = Object.fromEntries( datos.categorias.map( ( c ) => [ c.id, c.opciones[ 0 ].id ] ) );

	}

	categoria( id: string ): Categoria {

		return this.datos.categorias.find( ( c ) => c.id === id )!;

	}

	opcion( categoria: string, id = this.seleccion[ categoria ] ): Opcion {

		return this.categoria( categoria ).opciones.find( ( o ) => o.id === id )!;

	}

	/** Elige una opción. Devuelve la opción anterior para que quien llama decida qué reconstruir. */
	elegir( categoria: string, id: string, instantaneo = false ) {

		const anterior = this.opcion( categoria );
		this.seleccion[ categoria ] = id;
		this.aplicarParametros( categoria, instantaneo );
		return anterior;

	}

	/** Lleva los parámetros de la opción elegida a los uniforms (con fundido). */
	aplicarParametros( categoria: string, instantaneo = false ) {

		const destino = DESTINO[ categoria ];
		const params = this.opcion( categoria ).parametros;
		if ( ! destino || ! params ) return;
		const ahora = performance.now();
		for ( const [ k, valor ] of Object.entries( params ) ) {

			const u = destino[ k ];
			if ( ! u ) continue;
			const hasta = typeof valor === 'string' ? new THREE.Color( valor ) : valor;
			this.tweens = this.tweens.filter( ( t ) => t.u !== u );
			if ( instantaneo ) {

				if ( hasta instanceof THREE.Color ) ( u.value as THREE.Color ).copy( hasta );
				else u.value = hasta;
				continue;

			}

			const desde = u.value instanceof THREE.Color ? u.value.clone() : ( u.value as number );
			this.tweens.push( { u, desde, hasta, t0: ahora } );

		}

	}

	actualizar( ahora: number ) {

		this.tweens = this.tweens.filter( ( t ) => {

			const k = THREE.MathUtils.clamp( ( ahora - t.t0 ) / this.duracion, 0, 1 );
			const e = 1 - Math.pow( 1 - k, 3 );
			if ( t.desde instanceof THREE.Color ) ( t.u.value as THREE.Color ).copy( t.desde ).lerp( t.hasta as THREE.Color, e );
			else t.u.value = ( t.desde as number ) + ( ( t.hasta as number ) - ( t.desde as number ) ) * e;
			return k < 1;

		} );

	}

	get variante() {

		return this.opcion( 'distribucion' ).variante ?? null;

	}

	get piscina() {

		return !! this.opcion( 'exterior' ).piscina;

	}

	/** Opciones con coste, en el orden de las categorías. */
	get extras() {

		return this.datos.categorias.map( ( c ) => ( { categoria: c, opcion: this.opcion( c.id ) } ) ).filter( ( x ) => x.opcion.precio > 0 );

	}

	get totalExtras() {

		return this.extras.reduce( ( s, x ) => s + x.opcion.precio, 0 );

	}

	get total() {

		return this.datos.precioBase + this.totalExtras;

	}

	/** Restaura una selección guardada, ignorando opciones que ya no existan. */
	restaurar( s: Seleccion ) {

		for ( const c of this.datos.categorias ) if ( s[ c.id ] && c.opciones.some( ( o ) => o.id === s[ c.id ] ) ) this.elegir( c.id, s[ c.id ], true );

	}

}
