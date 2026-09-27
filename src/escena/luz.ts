// Cielo, sol y entorno de iluminación (IBL), todo procedural.

import * as THREE from 'three/webgpu';
import { atan, color, dot, float, max, mix, mx_fractal_noise_float, normalize, positionLocal, positionWorldDirection, pow, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { PALETA } from './materiales';

type N = any;

// Sol de media tarde desde el sur-suroeste, ~34° de altura: bajo el porche
// entra en las estancias y dibuja manchas de sol y sombras largas en el suelo.
export const DIR_SOL = new THREE.Vector3( - 0.5, 0.56, 0.66 ).normalize();

export const uFondo = {
	papel: uniform( 1 ),
	estudio: uniform( 0 ),
};

function cielo( dir: N, calido = false ): N {

	// para la iluminación (IBL) se usa una versión más cálida: el rebote real de
	// suelos y fachadas claras tiñe la luz; un cielo azul puro enfría los interiores
	const t = dir.y;
	const horizonte = color( calido ? '#f3efe8' : '#eef1f2' );
	const cenit = color( calido ? '#cfd9e2' : '#a9c1d8' );
	// bajo el horizonte: campo lejano velado (no una franja blanca)
	const suelo = color( calido ? '#ddd3c5' : '#b9bda6' );
	const arriba = mix( horizonte, cenit, pow( max( t, 0 ), 0.55 ) );
	const abajo = mix( mix( horizonte, suelo, 0.55 ), suelo, smoothstep( 0.0, - 0.08, t ) );
	let base = mix( abajo, arriba, smoothstep( - 0.02, 0.02, t ) );
	// nubes altas y dispersas (proyección sobre un plano de cielo)
	const p = dir.xz.div( max( t, 0.02 ).add( 0.12 ) ).mul( 0.9 );
	const n = mx_fractal_noise_float( vec3( p.x, p.y, 3.1 ), 5, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	const nubes = smoothstep( 0.52, 0.78, n ).mul( smoothstep( 0.015, 0.2, t ) ).mul( calido ? 0.35 : 0.75 );
	base = mix( base, color( '#fbfaf7' ).mul( mix( float( 0.9 ), float( 1.04 ), n ) ), nubes );
	if ( ! calido ) {

		// perfil lejano de colinas con arbolado, velado por la bruma
		const a = atan( dir.x, dir.z );
		const perfil = mx_fractal_noise_float( vec2( a.mul( 2.2 ), 1.7 ), 4, 2.0, 0.5 ).mul( 0.022 ).add( 0.018 );
		const colina = float( 1 ).sub( smoothstep( perfil.sub( 0.002 ), perfil, t ) ).mul( smoothstep( - 0.004, 0.0, t ) );
		base = mix( base, mix( color( '#9fa98f' ), horizonte, 0.45 ), colina );

	}

	const s = max( dot( dir, vec3( DIR_SOL.x, DIR_SOL.y, DIR_SOL.z ) ), 0 );
	const halo = pow( s, 12 ).mul( 0.35 ).add( pow( s, 400 ).mul( 4 ) );
	return base.add( color( '#fff1dc' ).mul( halo ) );

}

export function fondo(): N {

	const dir = positionWorldDirection;
	const estudio = mix( color( '#e9e7e2' ), color( '#f3f2ef' ), smoothstep( - 0.1, 0.6, dir.y ) );
	return mix( mix( cielo( dir ), estudio, uFondo.estudio ), color( PALETA.papel ).mul( 1.12 ), uFondo.papel );

}

export function entorno( renderer: THREE.WebGPURenderer ) {

	const escena = new THREE.Scene();
	const m = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide } );
	m.colorNode = cielo( normalize( positionLocal ), true ).mul( float( 1.0 ) );
	escena.add( new THREE.Mesh( new THREE.SphereGeometry( 50, 64, 32 ), m ) );
	const pmrem = new THREE.PMREMGenerator( renderer );
	const rt = pmrem.fromScene( escena, 0.03 );
	pmrem.dispose();
	return rt.texture;

}

export function sol( centro: THREE.Vector3 ) {

	const luz = new THREE.DirectionalLight( '#ffebd6', 2.7 );
	luz.position.copy( centro ).addScaledVector( DIR_SOL, 25 );
	luz.target.position.copy( centro );
	luz.castShadow = true;
	luz.shadow.mapSize.set( 4096, 4096 );
	const c = luz.shadow.camera;
	c.left = - 11; c.right = 11; c.top = 11; c.bottom = - 11; c.near = 5; c.far = 50;
	luz.shadow.bias = - 0.0003;
	luz.shadow.normalBias = 0.015;
	luz.shadow.radius = 4;
	return luz;

}
