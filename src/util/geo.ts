import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Punto, Rect } from '../modelo/tipos';

// Planta (x este, y norte) -> mundo three.js (x este, y arriba, z sur).
export const aMundo = ( x: number, y: number, altura = 0 ) => new THREE.Vector3( x, altura, - y );

export function puntoEnPoligono( x: number, y: number, pol: Punto[] ): boolean {

	let dentro = false;
	for ( let i = 0, j = pol.length - 1; i < pol.length; j = i ++ ) {

		const [ xi, yi ] = pol[ i ];
		const [ xj, yj ] = pol[ j ];
		if ( ( yi > y ) !== ( yj > y ) && x < ( xj - xi ) * ( y - yi ) / ( yj - yi ) + xi ) dentro = ! dentro;

	}

	return dentro;

}

export const puntoEnRect = ( x: number, y: number, r: Rect, margen = 0 ) =>
	x > r[ 0 ] - margen && x < r[ 2 ] + margen && y > r[ 1 ] - margen && y < r[ 3 ] + margen;

export const areaPoligono = ( p: Punto[] ) =>
	Math.abs( p.reduce( ( s, [ x, y ], i ) => {

		const [ x0, y0 ] = p[ ( i + p.length - 1 ) % p.length ];
		return s + x * y0 - x0 * y;

	}, 0 ) ) / 2;

export function centroide( p: Punto[] ): Punto {

	// Centro visual: centro de la caja envolvente desplazado hacia dentro si cae fuera.
	const xs = p.map( ( q ) => q[ 0 ] ), ys = p.map( ( q ) => q[ 1 ] );
	let c: Punto = [ ( Math.min( ...xs ) + Math.max( ...xs ) ) / 2, ( Math.min( ...ys ) + Math.max( ...ys ) ) / 2 ];
	if ( ! puntoEnPoligono( c[ 0 ], c[ 1 ], p ) ) {

		let mejor = c, d = Infinity;
		for ( let i = 0; i < 400; i ++ ) {

			const q: Punto = [ Math.min( ...xs ) + Math.random() * ( Math.max( ...xs ) - Math.min( ...xs ) ),
				Math.min( ...ys ) + Math.random() * ( Math.max( ...ys ) - Math.min( ...ys ) ) ];
			const dd = Math.hypot( q[ 0 ] - c[ 0 ], q[ 1 ] - c[ 1 ] );
			if ( dd < d && puntoEnPoligono( q[ 0 ], q[ 1 ], p ) ) {

				d = dd;
				mejor = q;

			}

		}

		c = mejor;

	}

	return c;

}

/** Forma 2D de un polígono de planta para ShapeGeometry/ExtrudeGeometry (en el plano XY, y = norte). */
export const forma = ( p: Punto[] ) => new THREE.Shape( p.map( ( [ x, y ] ) => new THREE.Vector2( x, y ) ) );

/**
 * Caja alineada con los ejes, en coordenadas de mundo.
 * x0..x1 (este), y0..y1 (norte, en planta), z0..z1 (altura).
 */
export function caja( x0: number, y0: number, x1: number, y1: number, z0: number, z1: number ): THREE.BufferGeometry {

	const g = new THREE.BoxGeometry( x1 - x0, z1 - z0, y1 - y0 );
	g.translate( ( x0 + x1 ) / 2, ( z0 + z1 ) / 2, - ( y0 + y1 ) / 2 );
	return g;

}

/** Une geometrías (descartando las nulas) conservando solo los atributos comunes. */
export function unir( gs: ( THREE.BufferGeometry | null | undefined )[] ): THREE.BufferGeometry | null {

	const validas = gs.filter( ( g ): g is THREE.BufferGeometry => !! g );
	if ( ! validas.length ) return null;
	const limpias = validas.map( ( g ) => {

		const n = g.index ? g.toNonIndexed() : g;
		for ( const k of Object.keys( n.attributes ) ) if ( ! [ 'position', 'normal', 'uv' ].includes( k ) ) n.deleteAttribute( k );
		if ( ! n.attributes.uv ) n.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( n.attributes.position.count * 2 ), 2 ) );
		n.clearGroups();
		return n;

	} );
	return mergeGeometries( limpias, false );

}
