import * as THREE from 'three/webgpu';
import { add, diffuseColor, float, mix, mrt, normalView, output, packNormalToRGB, pass, sample, unpackRGBToNormal, vec4, velocity } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import datos from './modelo/vivienda.json';
import datosVariantes from './modelo/variantes.json';
import datosConfiguracion from './modelo/configuracion.json';
import type { Configuracion, Variante, Vivienda } from './modelo/tipos';
import { centroide, puntoEnPoligono } from './util/geo';
import * as M from './escena/materiales';
import { construirMuros } from './escena/muros';
import { construirCantoPorche, construirSuelos } from './escena/suelos';
import { construirCarpinterias } from './escena/carpinterias';
import { construirEquipamiento } from './escena/equipamiento';
import { construirLineas } from './escena/lineas';
import { entorno, fondo, sol as crearSol } from './escena/luz';
import { Camarografo, type Vista } from './escena/camaras';
import { Estados } from './escena/estados';
import { construirPiscina, validarPiscina } from './escena/piscina';
import { aplicarVariante, fmtM2 } from './configurador/variantes';
import { Configurador, fmtEuros, fmtPrecio, type Seleccion } from './configurador/configurador';
import { Panel } from './configurador/panel';
import './estilos.css';

const base = datos as unknown as Vivienda;
const variantes = datosVariantes as unknown as Variante[];
const CLAVE_GUARDADO = 'inmobiliarias:configuracion';
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
	// La vivienda se construye en contenedores persistentes. Una variante de
	// distribución genera una vivienda nueva a partir del parche y solo se
	// sustituye el contenido de los contenedores: estados, cámaras y render
	// siguen apuntando a los mismos objetos.
	let estados!: Estados;
	const conf = new Configurador( datosConfiguracion as unknown as Configuracion );
	let vivienda = base;
	const H = base.alturas.libre.valor;
	M.U.altura.value = H;
	const matMuros = {
		pintura: M.conPoche( M.pintura( '#efede8', true, true ) ),
		alicatado: M.conPoche( M.alicatado( M.P.banos.pared, true ) ),
		fachada: M.conPoche( M.sate( '#f1efea' ) ),
	};
	const grupo = ( nombre: string ) => Object.assign( new THREE.Group(), { name: nombre } );
	const c = {
		muros: grupo( 'muros' ), suelos: grupo( 'suelos' ), techos: grupo( 'techos' ), volumenes: grupo( 'volumenes' ),
		carpinterias: grupo( 'carpinterias' ), barandilla: grupo( 'barandilla' ), fijo: grupo( 'equipamiento-fijo' ),
		mobiliario: grupo( 'mobiliario' ), lineas: grupo( 'lineas' ),
	};
	const volcar = ( destino: THREE.Group, origen: THREE.Object3D, liberarMateriales = false ) => {

		for ( const hijo of [ ...destino.children ] ) {

			hijo.traverse( ( o ) => {

				const m = o as THREE.Mesh;
				m.geometry?.dispose();
				if ( liberarMateriales ) ( Array.isArray( m.material ) ? m.material : [ m.material ] ).forEach( ( x ) => x?.dispose() );

			} );
			destino.remove( hijo );

		}

		for ( const hijo of [ ...origen.children ] ) destino.add( hijo );

	};

	const { entorno: suelo } = construirSuelos( base );
	const canto = construirCantoPorche( base );
	const centro = new THREE.Vector3( 6.35, 0, - 3.3 );
	const luzSol = crearSol( centro );
	const piscina = construirPiscina( conf.datos.piscina );
	const fallosPiscina = validarPiscina( conf.datos.piscina, base );
	if ( fallosPiscina.length ) console.warn( 'La piscina no cumple:', fallosPiscina.join( '; ' ) );
	escena.add( ...Object.values( c ), suelo!, canto, piscina, luzSol, luzSol.target );

	// ---------------------------------------------------------------- etiquetas
	const etiquetas = new CSS2DRenderer( { element: $( '#etiquetas' ) } );
	etiquetas.setSize( innerWidth, innerHeight );
	const grupoEtiquetas = new THREE.Group();
	escena.add( grupoEtiquetas );
	const construirEtiquetas = () => {

		for ( const o of [ ...grupoEtiquetas.children ] ) grupoEtiquetas.remove( o );
		for ( const e of vivienda.estancias ) {

			const div = document.createElement( 'div' );
			div.className = 'etiqueta';
			div.innerHTML = `<span class="nombre">${ e.nombre }</span><span class="sup">${ e.superficie.toLocaleString( 'es-ES', { minimumFractionDigits: 2 } ) } m²</span>`;
			const [ x, y ] = centroide( e.poligono );
			const o = new CSS2DObject( div );
			o.position.set( x, 0.05, - y );
			grupoEtiquetas.add( o );

		}

	};

	let interiores = base.estancias.filter( ( e ) => e.uso !== 'exterior' );
	const construirLineasActuales = () => volcar( c.lineas, construirLineas( vivienda, { piscina: conf.piscina ? conf.datos.piscina.rect : undefined } ), true );

	/** Reconstruye la vivienda según la distribución elegida. Devuelve el informe de cambios. */
	const reconstruir = () => {

		const variante = variantes.find( ( v ) => v.id === conf.variante ) ?? null;
		const r = aplicarVariante( base, variante );
		vivienda = r.vivienda;
		const { geos } = construirMuros( vivienda );
		const muros = new THREE.Group();
		for ( const k of Object.keys( geos ) as ( keyof typeof geos )[] ) {

			const m = new THREE.Mesh( geos[ k ], matMuros[ k ] );
			m.castShadow = m.receiveShadow = true;
			muros.add( m );

		}

		volcar( c.muros, muros );
		const s = construirSuelos( vivienda, false );
		volcar( c.suelos, s.suelos );
		volcar( c.techos, s.techos );
		volcar( c.volumenes, s.volumenes );
		const k = construirCarpinterias( vivienda );
		volcar( c.carpinterias, k.carpinterias );
		volcar( c.barandilla, k.barandilla );
		const e = construirEquipamiento( vivienda );
		volcar( c.fijo, e.fijo );
		volcar( c.mobiliario, e.mobiliario );
		construirLineasActuales();
		construirEtiquetas();
		interiores = vivienda.estancias.filter( ( x ) => x.uso !== 'exterior' );
		const util = interiores.reduce( ( t, x ) => t + x.superficie, 0 );
		$( '#util-interior' ).textContent = fmtM2( util );
		estados?.refrescar();
		return r.informe;

	};

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
	// Internamente se conservan los cuatro estados (sirven de transición: la
	// vivienda "se construye" al pasar del plano a la vivienda), pero la
	// interfaz solo ofrece tres modos: Plano, Vivienda y Personalizar.
	estados = new Estados( { volumenes: c.volumenes, lineas: c.lineas, carpinterias: [ c.carpinterias, c.barandilla ], fijo: c.fijo, mobiliario: c.mobiliario, sol: luzSol, escena } );
	reconstruir();
	const cam = new Camarografo( camara, ctrl, $( '#velo' ) );
	cam.reducido = estados.reducido;
	type Modo = 'plano' | 'vivienda' | 'personalizar';
	let modo: Modo = 'vivienda';

	const botonesModo = [ ...document.querySelectorAll<HTMLButtonElement>( '[data-modo]' ) ].filter( ( b ) => b.tagName === 'BUTTON' );
	const botonesVista = [ ...document.querySelectorAll<HTMLButtonElement>( '[data-vista]' ) ];
	const actualizarEtiquetas = () => document.body.classList.toggle( 'con-etiquetas', modo === 'plano' );
	const marcarVista = ( k: string ) => botonesVista.forEach( ( b ) => b.setAttribute( 'aria-pressed', String( b.dataset.vista === k ) ) );

	/** Mueve la cámara a una vista (una sola vez; si ya está allí no hace nada). */
	const irVista = ( v: string | Vista ) => {

		cam.ir( v );
		marcarVista( typeof v === 'string' ? v : '' );

	};

	const vistaDeVariante = () => ( variantes.find( ( v ) => v.id === conf.variante ) ?? variantes[ 0 ] )?.vista ?? null;

	const irModo = ( m: Modo ) => {

		const anterior = modo;
		modo = m;
		document.body.dataset.modo = m;
		botonesModo.forEach( ( b ) => b.setAttribute( 'aria-current', String( b.dataset.modo === m ) ) );
		const n = m === 'plano' ? 1 : 4;
		if ( estados.actual !== n ) estados.ir( n );
		document.body.dataset.estado = String( n );
		$( '#configurador' ).hidden = m !== 'personalizar';
		actualizarEtiquetas();
		if ( m === 'plano' ) {

			irVista( 'planta' );
			return;

		}

		// al salir del plano se vuelve a la vista general; entre Vivienda y
		// Personalizar la cámara no se mueve
		if ( anterior === 'plano' ) irVista( 'aerea' );

	};

	botonesModo.forEach( ( b ) => b.addEventListener( 'click', () => irModo( b.dataset.modo as Modo ) ) );
	botonesVista.forEach( ( b ) => b.addEventListener( 'click', () => irVista( b.dataset.vista! ) ) );
	addEventListener( 'keydown', ( ev ) => {

		const t = ev.target as HTMLElement | null;
		if ( t instanceof HTMLInputElement || t?.closest?.( '#configurador, dialog' ) ) return;
		const modos: Record<string, Modo> = { 1: 'plano', 2: 'vivienda', 3: 'personalizar' };
		if ( modos[ ev.key ] ) irModo( modos[ ev.key ] );

	} );
	ctrl.addEventListener( 'start', () => {

		cam.soltar();
		marcarVista( '' );

	} );

	// ---------------------------------------------------------------- personalizar
	const guardarLocal = () => {

		try {

			localStorage.setItem( CLAVE_GUARDADO, JSON.stringify( conf.seleccion ) );

		} catch { /* almacenamiento no disponible: la configuración vive solo en esta sesión */ }

	};

	/** Vista que corresponde a una categoría ("mantener" = ninguna). */
	const vistaDeCategoria = ( id: string ): string | Vista | null => {

		const v = conf.categoria( id ).vista;
		if ( v === 'mantener' ) return null;
		if ( v === 'variante' ) return vistaDeVariante() ?? 'aerea';
		return v;

	};

	// aviso breve tras un cambio, con una acción opcional
	const aviso = $( '#aviso' );
	let temporizadorAviso = 0;
	const avisar = ( texto: string, accion?: { etiqueta: string; hacer: () => void } ) => {

		( aviso.querySelector( '.texto' ) as HTMLElement ).textContent = texto;
		const boton = aviso.querySelector( '.accion' ) as HTMLButtonElement;
		boton.hidden = ! accion;
		boton.textContent = accion?.etiqueta ?? '';
		boton.onclick = accion ? () => {

			aviso.hidden = true;
			accion.hacer();

		} : null;
		aviso.hidden = false;
		clearTimeout( temporizadorAviso );
		temporizadorAviso = window.setTimeout( () => ( aviso.hidden = true ), 12000 );

	};

	// el aviso no se cierra mientras el ratón está encima
	aviso.addEventListener( 'pointerenter', () => clearTimeout( temporizadorAviso ) );
	aviso.addEventListener( 'pointerleave', () => ( temporizadorAviso = window.setTimeout( () => ( aviso.hidden = true ), 4000 ) ) );

	const panel = new Panel( conf, {
		abrir( categoria ) {

			// al desplegar una categoría se enseña la estancia a la que afecta
			const v = vistaDeCategoria( categoria );
			if ( v ) irVista( v );

		},
		elegir( categoria, opcion ) {

			const cat = conf.categoria( categoria );
			const anterior = conf.elegir( categoria, opcion );
			const nueva = conf.opcion( categoria );
			if ( categoria === 'distribucion' && anterior.variante !== nueva.variante ) {

				const informe = reconstruir();
				const variante = variantes.find( ( v ) => v.id === nueva.variante );
				panel.informe( 'distribucion', variante ? [ variante.descripcion, ...informe ] : [] );
				avisar( variante ? variante.resumen : 'Distribución base: salón y cocina vuelven a estar separados.', {
					etiqueta: 'Ver en plano', hacer: () => irModo( 'plano' ),
				} );

			}

			if ( categoria === 'exterior' ) construirLineasActuales();
			const activa = nueva.precio > 0 || !! nueva.piscina;
			const v = vistaDeCategoria( categoria );
			if ( v && ( ! cat.soloAlActivar || activa ) ) irVista( v );
			panel.resumen();
			guardarLocal();

		},
		cerrar: () => irModo( 'vivienda' ),
		guardar: () => mostrarResumen(),
	} );
	panel.desplegar( 'distribucion', false );

	const dialogo = $<HTMLDialogElement>( '#resumen-configuracion' );
	const mostrarResumen = () => {

		guardarLocal();
		const fecha = new Date().toLocaleString( 'es-ES', { dateStyle: 'long', timeStyle: 'short' } );
		const filas = conf.datos.categorias.map( ( k ) => {

			const o = conf.opcion( k.id );
			return `<tr><th scope="row">${ k.nombre }</th><td>${ o.nombre }${ o.detalle ? ` <span class="detalle">(${ o.detalle })</span>` : '' }</td><td>${ fmtPrecio( o.precio ) }</td></tr>`;

		} ).join( '' );
		const util = interiores.reduce( ( t, x ) => t + x.superficie, 0 );
		dialogo.querySelector( '.contenido' )!.innerHTML = `
			<p class="fecha">Guardada el ${ fecha }</p>
			<table>
				<tbody>${ filas }</tbody>
				<tfoot>
					<tr><th scope="row">Precio base vivienda</th><td></td><td>${ fmtEuros( conf.datos.precioBase ) }</td></tr>
					<tr><th scope="row">Total de extras</th><td></td><td>${ fmtEuros( conf.totalExtras ) }</td></tr>
					<tr class="total"><th scope="row">Precio total</th><td></td><td>${ fmtEuros( conf.total ) }</td></tr>
				</tfoot>
			</table>
			<p class="nota">Superficie útil interior con esta distribución: ${ fmtM2( util ) }. Precios orientativos de la prueba del configurador.</p>`;
		dialogo.dataset.texto = [
			`Configuración de vivienda (${ fecha })`,
			...conf.datos.categorias.map( ( k ) => `${ k.nombre }: ${ conf.opcion( k.id ).nombre } (${ fmtPrecio( conf.opcion( k.id ).precio ) })` ),
			`Precio base vivienda: ${ fmtEuros( conf.datos.precioBase ) }`,
			`Total de extras: ${ fmtEuros( conf.totalExtras ) }`,
			`Precio total: ${ fmtEuros( conf.total ) }`,
		].join( '\n' );
		dialogo.showModal();

	};

	dialogo.querySelector( '.cerrar-dialogo' )!.addEventListener( 'click', () => dialogo.close() );
	dialogo.querySelector( '.copiar' )!.addEventListener( 'click', async ( ev ) => {

		const b = ev.currentTarget as HTMLButtonElement;
		try {

			await navigator.clipboard.writeText( dialogo.dataset.texto ?? '' );
			b.textContent = 'Resumen copiado';

		} catch {

			b.textContent = 'No se ha podido copiar';

		}

		setTimeout( () => ( b.textContent = 'Copiar resumen' ), 2000 );

	} );

	// configuración guardada anteriormente en este navegador
	try {

		const guardada = JSON.parse( localStorage.getItem( CLAVE_GUARDADO ) ?? 'null' ) as Seleccion | null;
		if ( guardada ) {

			conf.restaurar( guardada );
			const variante = variantes.find( ( v ) => v.id === conf.variante );
			if ( variante ) panel.informe( 'distribucion', [ variante.descripcion, ...reconstruir() ] );
			construirLineasActuales();
			panel.sincronizar();

		}

	} catch { /* sin configuración guardada */ }

	// ---------------------------------------------------------------- captura de imagen
	const foto = async () => {

		const boton = $<HTMLButtonElement>( '#foto' );
		boton.disabled = true;
		boton.dataset.ocupado = 'true';
		const [ w, h ] = [ innerWidth, innerHeight ];
		const ratio = renderer.getPixelRatio();
		const escala = Math.min( 3, 2400 / Math.max( w, h ) * ( 1 / 1 ) );
		// la imagen usa el encuadre maestro, sin el desplazamiento del panel
		const desplazado = desplazamiento;
		encuadrar( 0 );
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
		encuadrar( desplazado );
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

		encuadrar( desplazamiento );
		cam.reencuadrar();
		renderer.setSize( innerWidth, innerHeight );
		etiquetas.setSize( innerWidth, innerHeight );

	} );

	// Con el cajón abierto, la composición de la cámara maestra se encaja entera en
	// el hueco libre: se reduce la imagen (camera.zoom) y se desplaza su centro
	// (setViewOffset). La cámara no cambia: misma posición, objetivo y fov.
	let desplazamiento = 0;
	const encuadrar = ( d: number ) => {

		const W = innerWidth, Hh = innerHeight;
		if ( d < 0.5 ) {

			camara.clearViewOffset();
			camara.aspect = W / Hh;
			camara.zoom = 1;

		} else {

			camara.aspect = ( W + d ) / Hh;
			camara.setViewOffset( W + d, Hh, d, 0, W, Hh );
			camara.zoom = ( W - d ) / W;

		}

		camara.updateProjectionMatrix();

	};

	let pausado = false;
	let exposicion = renderer.toneMappingExposure;
	let piscinaT = conf.piscina ? 1 : 0;
	renderer.setAnimationLoop( ( t ) => {

		if ( pausado ) return;
		estados.actualizar( t );
		cam.actualizar( performance.now() );
		ctrl.update();
		// dentro de la vivienda los techos proyectan sombra; en la maqueta no
		const bajo = camara.position.y < H + 0.2;
		for ( const tc of c.techos.children ) tc.castShadow = bajo || tc.userData.porche;
		c.techos.visible = estados.valores.muros > 0.98;
		canto.visible = bajo && c.techos.visible;
		conf.actualizar( performance.now() );
		const objetivo = modo === 'personalizar' && innerWidth > 760 ? innerWidth - $( '#configurador' ).getBoundingClientRect().left : 0;
		if ( Math.abs( objetivo - desplazamiento ) > 0.5 || ( desplazamiento > 0 && objetivo === 0 ) ) {

			desplazamiento += ( objetivo - desplazamiento ) * ( estados.reducido ? 1 : 0.2 );
			if ( Math.abs( objetivo - desplazamiento ) < 0.5 ) desplazamiento = objetivo;
			encuadrar( desplazamiento );

		}
		// piscina: aparece con el equipamiento (estados 3 y 4) si está elegida
		piscinaT += ( ( conf.piscina ? 1 : 0 ) - piscinaT ) * ( estados.reducido ? 1 : 0.08 );
		const ep = piscinaT * estados.valores.fijo;
		piscina.visible = ep > 0.003;
		piscina.scale.y = Math.max( 0.001, ep );
		// exposición automática: dentro de la vivienda se abre el "diafragma"
		const dentro = bajo && interiores.some( ( e ) => puntoEnPoligono( camara.position.x, - camara.position.z, e.poligono ) );
		exposicion += ( ( dentro ? 1.5 : 1.08 ) - exposicion ) * 0.06;
		renderer.toneMappingExposure = exposicion;
		pipeline.render();
		etiquetas.render( escena, camara );

	} );

	Object.assign( window, { __vivienda: { irModo, irEstado: ( n: number ) => irModo( n === 1 ? 'plano' : 'vivienda' ), cam, estados, renderer, camara, ctrl, pausar: ( p: boolean ) => ( pausado = p ) } } );
	// arranque: la vivienda se construye desde el plano y se muestra la vista general
	cam.ir( 'aerea', true );
	marcarVista( 'aerea' );
	irModo( 'vivienda' );
	document.body.classList.add( 'listo' );

}

iniciar().catch( ( err ) => {

	console.error( err );
	$( '#carga' ).textContent = 'No se ha podido iniciar el visor 3D en este navegador.';

} );
