// Rotulación del plano: dónde y en qué formato va el rótulo de cada estancia.
//
// Se busca, dentro del polígono de la estancia, el punto en que el rótulo
// (su caja real en metros, según la escala del plano en pantalla) no cruza
// muros, ni pisa mobiliario u otros rótulos, y queda cerca del centro. Si no
// cabe se prueban formatos más compactos: letra menor, dos líneas, nombre
// abreviado y, en planos muy pequeños (móvil), solo el nombre abreviado.

import type { Estancia, Rect, Vivienda } from '../modelo/tipos';
import { centroide, puntoEnPoligono } from '../util/geo';

export type Formato = 'normal' | 'compacta' | 'dos-lineas' | 'minima' | 'solo-nombre' | 'solo-nombre-2';

export interface Rotulo {
	x: number; y: number;
	formato: Formato;
	lineas: string[];
}

// métricas aproximadas de la tipografía de los rótulos (px por carácter)
const METRICAS: Record<Formato, { nombre: number; sup: number; alto: number; pad: number }> = {
	normal: { nombre: 7.4, sup: 6.3, alto: 34, pad: 16 },
	compacta: { nombre: 6.3, sup: 5.6, alto: 29, pad: 12 },
	'dos-lineas': { nombre: 6.3, sup: 5.6, alto: 41, pad: 12 },
	minima: { nombre: 5.4, sup: 5.0, alto: 25, pad: 8 },
	'solo-nombre': { nombre: 5.4, sup: 0, alto: 14, pad: 8 },
	'solo-nombre-2': { nombre: 5.4, sup: 0, alto: 24, pad: 8 },
};

const ABREVIATURAS: Record<string, string> = {
	dormitorio: 'Dorm.', principal: 'ppal.', distribuidor: 'Distrib.', espacio: 'Esp.', recibidor: 'Recib.',
	secundario: 'sec.', 'salón-comedor': 'Salón-com.', cocina: 'Cocina', terraza: 'Terraza',
};

/** Nombre abreviado para planos a escala pequeña (móvil). */
export const abreviar = ( n: string ) => n.split( ' ' ).map( ( w ) => ABREVIATURAS[ w.toLowerCase() ] ?? ( w.length > 8 ? `${ w.slice( 0, 5 ) }.` : w ) ).join( ' ' );

const interseccion = ( a: Rect, b: Rect ) => Math.max( 0, Math.min( a[ 2 ], b[ 2 ] ) - Math.max( a[ 0 ], b[ 0 ] ) ) * Math.max( 0, Math.min( a[ 3 ], b[ 3 ] ) - Math.max( a[ 1 ], b[ 1 ] ) );

function partir( nombre: string ) {

	const p = nombre.split( ' ' );
	if ( p.length < 2 ) return [ nombre ];
	// corte más equilibrado
	let mejor = 1, dif = Infinity;
	for ( let i = 1; i < p.length; i ++ ) {

		const d = Math.abs( p.slice( 0, i ).join( ' ' ).length - p.slice( i ).join( ' ' ).length );
		if ( d < dif ) {

			dif = d; mejor = i;

		}

	}

	return [ p.slice( 0, mejor ).join( ' ' ), p.slice( mejor ).join( ' ' ) ];

}

/**
 * @param pxPorMetro escala del plano en pantalla
 * @param supTexto texto de la superficie (p. ej. "24,77 m²")
 */
export function colocarRotulo( e: Estancia, v: Vivienda, pxPorMetro: number, supTexto: string, extra: Rect[] = [], ocupados: Rect[] = [] ): Rotulo & { caja: Rect } {

	const pol = e.poligono;
	const xs = pol.map( ( p ) => p[ 0 ] ), ys = pol.map( ( p ) => p[ 1 ] );
	const [ x0, x1, y0, y1 ] = [ Math.min( ...xs ), Math.max( ...xs ), Math.min( ...ys ), Math.max( ...ys ) ];
	const c = centroide( pol );
	const muebles = [ ...v.equipamiento.map( ( q ) => q.rect ), ...extra ];
	let mejor: Rotulo & { coste: number; caja: Rect } = { x: c[ 0 ], y: c[ 1 ], formato: 'solo-nombre', lineas: [ abreviar( e.nombre ) ], coste: Infinity, caja: [ c[ 0 ], c[ 1 ], c[ 0 ], c[ 1 ] ] };

	for ( const formato of [ 'normal', 'compacta', 'dos-lineas', 'minima', 'solo-nombre', 'solo-nombre-2' ] as Formato[] ) {

		const m = METRICAS[ formato ];
		const lineas = formato === 'dos-lineas' ? partir( e.nombre ) : formato === 'solo-nombre-2' ? partir( abreviar( e.nombre ) )
			: formato === 'minima' || formato === 'solo-nombre' ? [ abreviar( e.nombre ) ] : [ e.nombre ];
		const sup = formato.startsWith( 'solo' ) ? '' : supTexto;
		const anchoPx = Math.max( ...lineas.map( ( l ) => l.length * m.nombre ), sup.length * m.sup ) + m.pad;
		const hw = anchoPx / pxPorMetro / 2 + 0.04, hh = m.alto / pxPorMetro / 2 + 0.03;
		const paso = Math.max( 0.06, Math.min( x1 - x0, y1 - y0 ) / 30 );
		for ( let x = x0 + hw; x <= x1 - hw + 1e-6; x += paso ) for ( let y = y0 + hh; y <= y1 - hh + 1e-6; y += paso ) {

			if ( ! puntoEnPoligono( x, y, pol ) ) continue;
			const caja: Rect = [ x - hw, y - hh, x + hw, y + hh ];
			// la caja entera dentro de la estancia (no pisa muros)
			let fuera = 0;
			for ( const [ px, py ] of [ [ caja[ 0 ], caja[ 1 ] ], [ caja[ 2 ], caja[ 1 ] ], [ caja[ 0 ], caja[ 3 ] ], [ caja[ 2 ], caja[ 3 ] ], [ x, caja[ 1 ] ], [ x, caja[ 3 ] ], [ caja[ 0 ], y ], [ caja[ 2 ], y ] ] ) if ( ! puntoEnPoligono( px, py, pol ) ) fuera ++;
			if ( fuera ) continue;
			// no pisar otros rótulos ya colocados (planos pequeños)
			if ( ocupados.some( ( r ) => interseccion( caja, r ) > 0 ) ) continue;
			const pisa = muebles.reduce( ( s, r ) => s + interseccion( caja, r ), 0 ) / ( 4 * hw * hh );
			const coste = pisa * 10 + Math.hypot( x - c[ 0 ], y - c[ 1 ] ) * 0.35;
			if ( coste < mejor.coste ) mejor = { x, y, formato, lineas, coste, caja };

		}

		// cabe sin pisar casi nada: no hace falta un formato más pequeño
		if ( mejor.coste < 2.5 ) break;

	}

	return mejor;

}
