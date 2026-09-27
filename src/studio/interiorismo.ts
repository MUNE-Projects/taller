// Interiorismo asistido: de imágenes de referencia a una propuesta editable.
//
// En local (sin IA) se extrae la paleta de las referencias y se decide un
// estilo con reglas sencillas; con IA (capability `sample`, solo en el
// Studio) Claude devuelve la misma estructura. En ambos casos la propuesta
// solo usa activos de la biblioteca: el resultado es una escena 3D editable.

import * as THREE from 'three/webgpu';
import { BIBLIOTECA, type Ambientacion } from '../biblioteca/biblioteca';
import type { Vivienda } from '../modelo/tipos';

export interface Propuesta {
	origen?: 'local' | 'ia';
	estilo?: string;
	resumen?: string;
	paleta?: string[];
	sustituciones?: Record<string, string>;
	decoracion?: Record<string, string>;
	variantes?: { base: string; nombre: string; colores: Record<string, string | string[]> }[];
	aplicar_variantes_a?: Record<string, number>;
}

/** Paleta dominante (k-medias sobre píxeles reducidos) de varias imágenes. */
export async function extraerPaleta( ficheros: File[], k = 6 ): Promise<string[]> {

	const px: [ number, number, number ][] = [];
	const lienzo = document.createElement( 'canvas' );
	lienzo.width = lienzo.height = 48;
	const ctx = lienzo.getContext( '2d', { willReadFrequently: true } );
	if ( ! ctx ) return [];
	for ( const f of ficheros ) {

		try {

			const bmp = await createImageBitmap( f );
			ctx.drawImage( bmp, 0, 0, 48, 48 );
			const d = ctx.getImageData( 0, 0, 48, 48 ).data;
			for ( let i = 0; i < d.length; i += 4 ) px.push( [ d[ i ], d[ i + 1 ], d[ i + 2 ] ] );

		} catch { /* imagen ilegible: se ignora */ }

	}

	if ( ! px.length ) return [];
	let centros = Array.from( { length: k }, ( _, i ) => px[ Math.floor( ( i + 0.5 ) * px.length / k ) ].slice() as [ number, number, number ] );
	for ( let it = 0; it < 8; it ++ ) {

		const suma = centros.map( () => [ 0, 0, 0, 0 ] );
		for ( const p of px ) {

			let mejor = 0, dm = Infinity;
			centros.forEach( ( c, i ) => {

				const d = ( p[ 0 ] - c[ 0 ] ) ** 2 + ( p[ 1 ] - c[ 1 ] ) ** 2 + ( p[ 2 ] - c[ 2 ] ) ** 2;
				if ( d < dm ) {

					dm = d; mejor = i;

				}

			} );
			const s = suma[ mejor ];
			s[ 0 ] += p[ 0 ]; s[ 1 ] += p[ 1 ]; s[ 2 ] += p[ 2 ]; s[ 3 ] ++;

		}

		centros = centros.map( ( c, i ) => ( suma[ i ][ 3 ] ? [ suma[ i ][ 0 ] / suma[ i ][ 3 ], suma[ i ][ 1 ] / suma[ i ][ 3 ], suma[ i ][ 2 ] / suma[ i ][ 3 ] ] : c ) as [ number, number, number ] );

	}

	return centros.map( ( c ) => `#${ new THREE.Color( c[ 0 ] / 255, c[ 1 ] / 255, c[ 2 ] / 255 ).getHexString() }` );

}

const hsl = ( hex: string ) => new THREE.Color( hex ).getHSL( { h: 0, s: 0, l: 0 } );

/** Propuesta sin IA: estilo por temperatura y luminosidad de la paleta. */
export function propuestaLocal( paleta: string[], amb: Ambientacion, v: Vivienda ): Propuesta {

	if ( ! paleta.length ) paleta = [ '#e8e2d8', '#c9b8a0', '#b8704f', '#8c957c', '#56616b' ];
	const cols = paleta.map( ( c ) => ( { c, ...hsl( c ) } ) );
	const luz = cols.reduce( ( s, x ) => s + x.l, 0 ) / cols.length;
	const calidos = cols.filter( ( x ) => x.s > 0.12 && ( x.h < 0.14 || x.h > 0.9 ) ).length;
	const verdes = cols.filter( ( x ) => x.s > 0.1 && x.h > 0.18 && x.h < 0.45 ).length;
	const estilo = luz < 0.42 ? 'ecléctico cálido' : calidos >= verdes ? 'mediterráneo contemporáneo' : 'orgánico';
	// neutro claro para tapicerías; acentos saturados para textiles pequeños
	const neutro = [ ...cols ].sort( ( a, b ) => a.s - b.s || b.l - a.l ).find( ( x ) => x.l > 0.55 )?.c ?? '#e4ddd0';
	const acentos = [ ...cols ].filter( ( x ) => x.c !== neutro && x.l > 0.2 && x.l < 0.8 ).sort( ( a, b ) => b.s - a.s ).map( ( x ) => x.c );
	const a1 = acentos[ 0 ] ?? '#b8704f', a2 = acentos[ 1 ] ?? '#8c957c';

	const elegir = ( categoria: string, tipo: string | null, preferir: string[] ) => {

		const opciones = BIBLIOTECA.activos.filter( ( a ) => a.categoria === categoria && ( ! tipo || a.sustituye?.includes( tipo ) ) );
		return ( opciones.find( ( a ) => preferir.some( ( p ) => a.estilo.includes( p ) ) ) ?? opciones[ 0 ] )?.id;

	};

	const sustituciones: Record<string, string> = {};
	const aplicar: Record<string, number> = {};
	const variantes: Propuesta[ 'variantes' ] = [];
	const clave = estilo === 'orgánico' ? [ 'orgánico', 'nórdico' ] : estilo === 'ecléctico cálido' ? [ 'ecléctico', 'clásico' ] : [ 'mediterráneo', 'nórdico' ];

	const sofaBase = elegir( 'sofas', 'sofa', clave );
	if ( sofaBase ) {

		variantes.push( { base: sofaBase, nombre: `Sofá ${ estilo } (paleta de referencia)`, colores: { tela: neutro, cojines: [ a1, neutro, a2 ], manta: a2 } } );
		for ( const e of v.equipamiento.filter( ( x ) => x.tipo === 'sofa' ) ) aplicar[ e.id ] = variantes.length - 1;

	}

	const camaBase = elegir( 'camas', 'cama', clave );
	if ( camaBase ) {

		variantes.push( { base: camaBase, nombre: `Cama ${ estilo } (paleta de referencia)`, colores: { cojines: [ a1, neutro, a2 ], plaid: a1 } } );
		for ( const e of v.equipamiento.filter( ( x ) => x.tipo === 'cama' && x.rect[ 2 ] - x.rect[ 0 ] > 1.2 && x.rect[ 3 ] - x.rect[ 1 ] > 1.2 ) ) aplicar[ e.id ] = variantes.length - 1;

	}

	for ( const [ tipo, cat ] of [ [ 'mesa-centro', 'mesas' ], [ 'mesa-comedor', 'mesas' ], [ 'silla', 'sillas' ], [ 'mesilla', 'mesillas' ], [ 'mueble-tv', 'almacenaje' ] ] as const ) {

		const id = elegir( cat, tipo, clave );
		if ( id ) for ( const e of v.equipamiento.filter( ( x ) => x.tipo === tipo ) ) sustituciones[ e.id ] = id;

	}

	// decoración: cuadros y alfombras al estilo
	const decoracion: Record<string, string> = {};
	for ( const d of amb.decoracion ) {

		const cat = BIBLIOTECA.activos.find( ( a ) => a.id === d.activo )?.categoria;
		if ( cat === 'cuadros' ) {

			const id = elegir( cat, null, clave );
			if ( id ) decoracion[ d.id ] = id;

		}

	}

	return {
		origen: 'local', estilo, paleta,
		resumen: `Ambientación ${ estilo } a partir de la paleta de las referencias: tapicerías en ${ neutro }, acentos textiles en ${ a1 } y ${ a2 }. Todo queda editable pieza a pieza.`,
		sustituciones, decoracion, variantes, aplicar_variantes_a: aplicar,
	};

}
