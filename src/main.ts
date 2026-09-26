import * as THREE from 'three/webgpu';
import { add, diffuseColor, float, mix, mrt, normalView, output, packNormalToRGB, pass, sample, unpackRGBToNormal, vec4, velocity } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import datos from './modelo/vivienda.json';
import type { Vivienda } from './modelo/tipos';
import { centroide, puntoEnPoligono } from './util/geo';
import * as M from './escena/materiales';
import { construirMuros } from './escena/muros';
import { construirCantoPorche, construirSuelos } from './escena/suelos';
import { construirCarpinterias } from './escena/carpinterias';
import { construirEquipamiento } from './escena/equipamiento';
import { construirLineas } from './escena/lineas';
import { entorno, fondo, sol as crearSol } from './escena/luz';
import { Camarografo, VISTAS } from './escena/camaras';
import { ESTADOS, Estados } from './escena/estados';
import './estilos.css';

const vivienda = datos as unknown as Vivienda;
const $ = <T extends HTMLElement>( s: string ) => document.querySelector( s ) as T;

async function iniciar() {

	const lienzo = $( '#lienzo' );
	const forzarWebGL = new URLSearchParams( location.search ).has( 'webgl' );
	const renderer = new THREE.WebGPURenderer( { antialias: false, forceWebGL: forzarWebGL } );
	renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );
	renderer.setSize( innerWidth, innerHeight );
	renderer.toneMapping = THREE.NeutralToneMapping;
	renderer.toneMappingExposure = 1.08;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	lienzo.appendChild( renderer.domElement );
	await renderer.init();
	const backend = ( renderer.backend as unknown as { isWebGPUBackend?: boolean } ).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
	$( '#motor' ).textContent = backend;

	const escena = new THREE.Scene();
	escena.backgroundNode = fondo();
	escena.environment = entorno( renderer );

	const camara = new THREE.PerspectiveCamera( 28, innerWidth / innerHeight, 0.05, 200 );
	const ctrl = new OrbitControls( camara, renderer.domElement );
	ctrl.enableDamping = true;
	ctrl.dampingFactor = 0.08;
	ctrl.maxPolarAngle = Math.PI * 0.495;
	ctrl.minDistance = 0.3;
	ctrl.maxDistance = 60;

	// ---------------------------------------------------------------- modelo
	const H = vivienda.alturas.libre.valor;
	M.U.altura.value = H;
	const { geos } = construirMuros( vivienda );
	const matMuros = {
		pintura: M.conPoche( M.pintura( '#efede8', true, true ) ),
		alicatado: M.conPoche( M.alicatado( '#dcd8d1', true ) ),
		fachada: M.conPoche( M.sate( '#f1efea' ) ),
	};
	const muros = new THREE.Group();
	muros.name = 'muros';
	for ( const k of Object.keys( geos ) as ( keyof typeof geos )[] ) {

		const m = new THREE.Mesh( geos[ k ], matMuros[ k ] );
		m.castShadow = m.receiveShadow = true;
		muros.add( m );

	}

	const { suelos, techos, volumenes, entorno: suelo } = construirSuelos( vivienda );
	const { carpinterias, barandilla } = construirCarpinterias( vivienda );
	const { fijo, mobiliario } = construirEquipamiento( vivienda );
	const lineas = construirLineas( vivienda );
	const canto = construirCantoPorche( vivienda );
	const centro = new THREE.Vector3( 6.35, 0, - 3.3 );
	const luzSol = crearSol( centro );
	escena.add( muros, suelos, techos, volumenes, suelo, carpinterias, barandilla, fijo, mobiliario, lineas, canto, luzSol, luzSol.target );

	// ---------------------------------------------------------------- etiquetas
	const etiquetas = new CSS2DRenderer( { element: $( '#etiquetas' ) } );
	etiquetas.setSize( innerWidth, innerHeight );
	const grupoEtiquetas = new THREE.Group();
	for ( const e of vivienda.estancias ) {

		const div = document.createElement( 'div' );
		div.className = 'etiqueta';
		div.innerHTML = `<span class="nombre">${ e.nombre }</span><span class="sup">${ e.superficie.toLocaleString( 'es-ES', { minimumFractionDigits: 2 } ) } m²</span>`;
		const [ x, y ] = centroide( e.poligono );
		const o = new CSS2DObject( div );
		o.position.set( x, 0.05, - y );
		grupoEtiquetas.add( o );

	}

	escena.add( grupoEtiquetas );

	// ---------------------------------------------------------------- posproceso
	const pipeline = new THREE.RenderPipeline( renderer );
	const escenaPass = pass( escena, camara );
	escenaPass.setMRT( mrt( { output, diffuseColor, normal: packNormalToRGB( normalView ), velocity } ) );
	const color = escenaPass.getTextureNode( 'output' );
	const difuso = escenaPass.getTextureNode( 'diffuseColor' );
	const profundidad = escenaPass.getTextureNode( 'depth' );
	const normal = escenaPass.getTextureNode( 'normal' );
	const vel = escenaPass.getTextureNode( 'velocity' );
	escenaPass.getTexture( 'diffuseColor' ).type = THREE.UnsignedByteType;
	escenaPass.getTexture( 'normal' ).type = THREE.UnsignedByteType;
	const normalEscena = sample( ( uv ) => unpackRGBToNormal( normal.sample( uv ) ) );
	const gi = ssgi( color, profundidad, normalEscena, camara );
	gi.sliceCount.value = 2;
	gi.stepCount.value = 8;
	gi.radius.value = 4;
	gi.giIntensity.value = 1.6;
	gi.aoIntensity.value = 1.0;
	gi.thickness.value = 0.5;
	// en planta la oclusión se atenúa para que el papel quede limpio
	const ao = mix( gi.getAONode(), float( 1 ), M.U.plano.mul( 0.85 ) );
	const compuesto = vec4( add( color.rgb.mul( ao ), difuso.rgb.mul( gi.getGINode().rgb ) ), color.a );
	pipeline.outputNode = traa( compuesto, profundidad, vel, camara );

	// ---------------------------------------------------------------- estados y cámara
	const estados = new Estados( { volumenes, lineas, carpinterias: [ carpinterias, barandilla ], fijo, mobiliario, sol: luzSol, escena } );
	const cam = new Camarografo( camara, ctrl );
	cam.ir( 'planta', 0 );

	const botonesEstado = [ ...document.querySelectorAll<HTMLButtonElement>( '[data-estado]' ) ];
	const botonesVista = [ ...document.querySelectorAll<HTMLButtonElement>( '[data-vista]' ) ];
	const marcarVista = ( k: string ) => botonesVista.forEach( ( b ) => b.setAttribute( 'aria-pressed', String( b.dataset.vista === k ) ) );
	const irEstado = ( n: number, moverCamara = true ) => {

		const anterior = estados.actual;
		estados.ir( n );
		const o = ESTADOS[ n ];
		document.body.dataset.estado = String( n );
		document.body.classList.toggle( 'con-etiquetas', o.etiquetas );
		botonesEstado.forEach( ( b ) => b.setAttribute( 'aria-current', String( Number( b.dataset.estado ) === n ) ) );
		$( '#lema' ).textContent = o.lema;
		// solo cambia de vista si la actual no sirve para el estado: al entrar o salir
		// de la planta, o si se está dentro de la vivienda en un estado sin interiores
		const interior = VISTAS[ cam.actual ]?.interior;
		if ( moverCamara && ( anterior === 1 || n === 1 || ( interior && n < 3 ) ) ) {

			cam.ir( o.vista, estados.reducido ? 0 : 1.6 );
			marcarVista( o.vista );

		}

	};

	botonesEstado.forEach( ( b ) => b.addEventListener( 'click', () => irEstado( Number( b.dataset.estado ) ) ) );
	botonesVista.forEach( ( b ) => b.addEventListener( 'click', () => {

		const k = b.dataset.vista!;
		if ( VISTAS[ k ].interior && estados.actual < 3 ) irEstado( 4, false );
		cam.ir( k, estados.reducido ? 0 : 1.6 );
		marcarVista( k );

	} ) );
	addEventListener( 'keydown', ( ev ) => {

		if ( ev.target instanceof HTMLInputElement ) return;
		const n = Number( ev.key );
		if ( n >= 1 && n <= 4 ) irEstado( n );
		if ( ev.key === 'ArrowRight' ) irEstado( Math.min( 4, estados.actual + 1 ) );
		if ( ev.key === 'ArrowLeft' ) irEstado( Math.max( 1, estados.actual - 1 ) );

	} );
	ctrl.addEventListener( 'start', () => {

		marcarVista( '' );
		cam.actual = '';

	} );

	// ---------------------------------------------------------------- captura de imagen
	const foto = async () => {

		const boton = $<HTMLButtonElement>( '#foto' );
		boton.disabled = true;
		boton.dataset.ocupado = 'true';
		const [ w, h ] = [ innerWidth, innerHeight ];
		const ratio = renderer.getPixelRatio();
		const escala = Math.min( 3, 2400 / Math.max( w, h ) * ( 1 / 1 ) );
		renderer.setPixelRatio( escala );
		gi.sliceCount.value = 3;
		gi.stepCount.value = 16;
		for ( let i = 0; i < 72; i ++ ) {

			pipeline.render();
			if ( i % 8 === 0 ) await new Promise( requestAnimationFrame );

		}

		pipeline.render();
		const url = renderer.domElement.toDataURL( 'image/png' );
		const nombre = `vivienda-${ cam.actual || 'vista' }-${ Date.now() }.png`;
		// la imagen se muestra siempre en pantalla: en visores que bloquean
		// descargas se puede guardar con clic derecho o pulsación larga
		$<HTMLImageElement>( '#captura img' ).src = url;
		const enlace = $<HTMLAnchorElement>( '#captura a' );
		enlace.href = url;
		enlace.download = nombre;
		$( '#captura' ).hidden = false;
		renderer.setPixelRatio( ratio );
		gi.sliceCount.value = 2;
		gi.stepCount.value = 8;
		boton.disabled = false;
		delete boton.dataset.ocupado;

	};

	$( '#foto' ).addEventListener( 'click', foto );

	// Publicado en claude.ai, las descargas pasan por el capability `downloads`
	// (el visor bloquea los enlaces de descarga normales). En local, enlace normal.
	type Descargas = { save( r: { filename: string; data: Blob } ): Promise<unknown> } | null;
	const rt = ( window as unknown as { claude?: { use( n: string ): Promise<unknown> } } ).claude;
	let descargas: Descargas = null;
	rt?.use?.( 'downloads' ).then( ( d ) => ( descargas = d as Descargas ), () => {} );
	$( '#captura a' ).addEventListener( 'click', async ( ev ) => {

		const d = descargas;
		if ( ! d ) return; // sin capability: el enlace normal hace la descarga
		ev.preventDefault();
		const a = ev.currentTarget as HTMLAnchorElement;
		const blob = await ( await fetch( a.href ) ).blob();
		d.save( { filename: a.download, data: blob } ).catch( () => {} );

	} );
	$( '#captura button' ).addEventListener( 'click', () => ( $( '#captura' ).hidden = true ) );
	addEventListener( 'keydown', ( ev ) => {

		if ( ev.key === 'Escape' ) $( '#captura' ).hidden = true;

	} );

	// ---------------------------------------------------------------- bucle
	addEventListener( 'resize', () => {

		camara.aspect = innerWidth / innerHeight;
		camara.updateProjectionMatrix();
		cam.reencuadrar();
		renderer.setSize( innerWidth, innerHeight );
		etiquetas.setSize( innerWidth, innerHeight );

	} );

	let pausado = false;
	let exposicion = renderer.toneMappingExposure;
	const interiores = vivienda.estancias.filter( ( e ) => e.uso !== 'exterior' );
	renderer.setAnimationLoop( ( t ) => {

		if ( pausado ) return;
		estados.actualizar( t );
		cam.actualizar( performance.now() );
		ctrl.update();
		// dentro de la vivienda los techos proyectan sombra; en la maqueta no
		const bajo = camara.position.y < H + 0.2;
		for ( const tc of techos.children ) tc.castShadow = bajo || tc.userData.porche;
		techos.visible = estados.valores.muros > 0.98;
		canto.visible = bajo && techos.visible;
		// exposición automática: dentro de la vivienda se abre el "diafragma"
		const dentro = bajo && interiores.some( ( e ) => puntoEnPoligono( camara.position.x, - camara.position.z, e.poligono ) );
		exposicion += ( ( dentro ? 1.5 : 1.08 ) - exposicion ) * 0.06;
		renderer.toneMappingExposure = exposicion;
		pipeline.render();
		etiquetas.render( escena, camara );

	} );

	Object.assign( window, { __vivienda: { irEstado, cam, estados, renderer, pausar: ( p: boolean ) => ( pausado = p ) } } );
	irEstado( 1, false );
	document.body.classList.add( 'listo' );

}

iniciar().catch( ( err ) => {

	console.error( err );
	$( '#carga' ).textContent = 'No se ha podido iniciar el visor 3D en este navegador.';

} );
