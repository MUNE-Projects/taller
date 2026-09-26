// Cielo, sol y entorno de iluminación (IBL), todo procedural.

import * as THREE from 'three/webgpu';
import { color, dot, float, max, mix, normalize, positionLocal, positionWorldDirection, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import { PALETA } from './materiales';

type N = any;

// Sol desde el sur-suroeste, ~50° de altura: la fachada con terraza mira al sur (norte del plano).
export const DIR_SOL = new THREE.Vector3( - 0.38, 0.78, 0.5 ).normalize();

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
	const suelo = color( calido ? '#ddd3c5' : '#dcd7cf' );
	const arriba = mix( horizonte, cenit, pow( max( t, 0 ), 0.55 ) );
	const abajo = mix( horizonte, suelo, smoothstep( 0.0, - 0.25, t ) );
	const base = mix( abajo, arriba, smoothstep( - 0.02, 0.02, t ) );
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

	const luz = new THREE.DirectionalLight( '#fff2e2', 3 );
	luz.position.copy( centro ).addScaledVector( DIR_SOL, 25 );
	luz.target.position.copy( centro );
	luz.castShadow = true;
	luz.shadow.mapSize.set( 4096, 4096 );
	const c = luz.shadow.camera;
	c.left = - 11; c.right = 11; c.top = 11; c.bottom = - 11; c.near = 5; c.far = 50;
	luz.shadow.bias = - 0.0003;
	luz.shadow.normalBias = 0.015;
	luz.shadow.radius = 3;
	return luz;

}
