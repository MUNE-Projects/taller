// Aplica una variante de distribución (un parche) sobre la vivienda base.
//
// Garantías:
//  - lo que el parche no nombra se copia tal cual (misma geometría, mismos ids);
//  - las superficies de las estancias modificadas se recalculan a partir de la
//    diferencia de área de su polígono respecto a la base (se conserva la cifra
//    oficial y se le suma o resta lo que cambia);
//  - el equipamiento apoyado en un muro que cambia se recoloca solo: se ajusta
//    al tramo de muro que queda o, si no cabe, se retira. Todo queda en el informe.

import type { Equipamiento, Rect, Variante, Vivienda } from '../modelo/tipos';
import { areaPoligono, puntoEnRect } from '../util/geo';

const NOMBRES: Record<string, string> = {
	'mueble-tv': 'Mueble de TV', armario: 'Armario', encimera: 'Encimera de cocina', 'columna-frigorifico': 'Columna del frigorífico',
	'columna-hornos': 'Columna de hornos', lavabo: 'Lavabo', 'lavabo-doble': 'Lavabo doble', inodoro: 'Inodoro', lavadora: 'Lavadora',
};

/** Largo mínimo al que puede ajustarse un mueble que pierde parte de su muro. */
const LARGO_MINIMO: Record<string, number> = { 'mueble-tv': 1.2, armario: 0.5, encimera: 1.2 };

/** Tipos que necesitan un muro detrás; si lo pierden y no pueden ajustarse, se retiran. */
const NECESITA_APOYO = new Set( [ 'mueble-tv', 'armario', 'encimera', 'columna-frigorifico', 'columna-hornos', 'lavabo', 'lavabo-doble', 'inodoro', 'lavadora' ] );

export interface Resultado {
	vivienda: Vivienda;
	informe: string[];
}

function parchear<T extends { id: string }>( lista: T[], p?: { quitar?: string[]; anadir?: T[]; modificar?: Record<string, Partial<T>> } ) {

	if ( ! p ) return lista;
	const quitar = new Set( p.quitar ?? [] );
	const out = lista.filter( ( x ) => ! quitar.has( x.id ) ).map( ( x ) => ( p.modificar?.[ x.id ] ? { ...x, ...p.modificar[ x.id ] } : x ) );
	return [ ...out, ...( p.anadir ?? [] ) ];

}

/** Cobertura del lado trasero de un mueble: muestras cada 2 cm, true si hay muro detrás. */
function apoyo( e: Equipamiento, v: Vivienda ) {

	const [ x0, y0, x1, y1 ] = e.rect;
	const enX = e.frente === 'n' || e.frente === 's';
	const [ a, b ] = enX ? [ x0, x1 ] : [ y0, y1 ];
	const detras = { s: y1 + 0.03, n: y0 - 0.03, o: x1 + 0.03, e: x0 - 0.03 }[ e.frente ];
	const n = Math.max( 2, Math.round( ( b - a ) / 0.02 ) );
	const muestras: boolean[] = [];
	for ( let i = 0; i < n; i ++ ) {

		const t = a + ( b - a ) * ( i + 0.5 ) / n;
		const [ px, py ] = enX ? [ t, detras ] : [ detras, t ];
		muestras.push( v.muros.some( ( m ) => puntoEnRect( px, py, m.rect, 0.005 ) ) );

	}

	return { muestras, a, b, enX };

}

function tramoMasLargo( m: boolean[] ) {

	let mejor: [ number, number ] = [ 0, 0 ], i0 = - 1;
	m.forEach( ( s, i ) => {

		if ( s && i0 < 0 ) i0 = i;
		if ( ( ! s || i === m.length - 1 ) && i0 >= 0 ) {

			const i1 = s ? i + 1 : i;
			if ( i1 - i0 > mejor[ 1 ] - mejor[ 0 ] ) mejor = [ i0, i1 ];
			i0 = - 1;

		}

	} );
	return mejor;

}

const solapa = ( r: Rect, s: Rect ) => r[ 0 ] < s[ 2 ] - 0.01 && r[ 2 ] > s[ 0 ] + 0.01 && r[ 1 ] < s[ 3 ] - 0.01 && r[ 3 ] > s[ 1 ] + 0.01;

export function aplicarVariante( base: Vivienda, variante: Variante | null ): Resultado {

	const informe: string[] = [];
	if ( ! variante ) return { vivienda: base, informe };
	const v: Vivienda = structuredClone( base );

	v.muros = parchear( v.muros, variante.muros );
	const murosVivos = new Set( v.muros.map( ( m ) => m.id ) );
	v.huecos = parchear( v.huecos, variante.huecos ).filter( ( h ) => murosVivos.has( h.muro ) );

	// estancias: nombre/polígono del parche; la superficie se recalcula por diferencia de área
	v.estancias = v.estancias.map( ( e ) => {

		const p = variante.estancias?.modificar?.[ e.id ];
		if ( ! p ) return e;
		const nueva = { ...e, ...p };
		if ( p.poligono && p.superficie === undefined ) {

			const delta = areaPoligono( p.poligono ) - areaPoligono( e.poligono );
			nueva.superficie = Math.round( ( e.superficie + delta ) * 100 ) / 100;
			if ( Math.abs( delta ) >= 0.005 ) informe.push( `${ nueva.nombre }: ${ fmtM2( e.superficie ) } → ${ fmtM2( nueva.superficie ) }` );

		}

		return nueva;

	} );

	v.equipamiento = parchear( v.equipamiento, variante.equipamiento );

	// recolocación automática del equipamiento afectado
	const cambiados = new Set( [ ...Object.keys( variante.muros?.modificar ?? {} ), ...( variante.muros?.quitar ?? [] ), ...( variante.muros?.anadir ?? [] ).map( ( m ) => m.id ) ] );
	const murosNuevos = v.muros.filter( ( m ) => cambiados.has( m.id ) );
	v.equipamiento = v.equipamiento.flatMap( ( e ) => {

		const nombre = NOMBRES[ e.tipo ] ?? e.tipo;
		// un muro nuevo o desplazado que atraviesa el mueble lo deja sin sitio
		if ( murosNuevos.some( ( m ) => m.tipo !== 'pilar' && solapa( m.rect, e.rect ) ) ) {

			informe.push( `${ nombre }: retirado, un tabique nuevo ocupa su posición` );
			return [];

		}

		if ( ! NECESITA_APOYO.has( e.tipo ) ) return [ e ];
		const antes = apoyo( e, base );
		const ahora = apoyo( e, v );
		if ( antes.muestras.join() === ahora.muestras.join() ) return [ e ];

		const [ i0, i1 ] = tramoMasLargo( ahora.muestras );
		const paso = ( ahora.b - ahora.a ) / ahora.muestras.length;
		const a = ahora.a + i0 * paso, b = ahora.a + i1 * paso;
		const minimo = LARGO_MINIMO[ e.tipo ];
		if ( minimo !== undefined && b - a >= minimo ) {

			const r: Rect = [ ...e.rect ];
			if ( ahora.enX ) [ r[ 0 ], r[ 2 ] ] = [ a, b ];
			else [ r[ 1 ], r[ 3 ] ] = [ a, b ];
			informe.push( `${ nombre }: ajustado al muro que se conserva (${ fmtM( ahora.b - ahora.a ) } → ${ fmtM( b - a ) })` );
			return [ { ...e, rect: r, origen: `${ e.origen } + recolocado` } ];

		}

		informe.push( `${ nombre }: retirado, se queda sin muro de apoyo` );
		return [];

	} );

	return { vivienda: v, informe };

}

export const fmtM2 = ( n: number ) => `${ n.toLocaleString( 'es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) } m²`;
const fmtM = ( n: number ) => `${ n.toLocaleString( 'es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) } m`;
