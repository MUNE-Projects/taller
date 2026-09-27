import * as THREE from 'three/webgpu';
import { add, diffuseColor, float, luminance, max, metalness, mix, mrt, normalView, output, packNormalToRGB, pass, pow, renderOutput, roughness, sample, smoothstep, unpackRGBToNormal, uv, vec2, vec3, vec4, velocity } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import type { Rect, Vivienda, ViviendaPromocion } from './modelo/tipos';
import { colocarRotulo } from './escena/rotulos';
import { puntoEnPoligono } from './util/geo';
import * as M from './escena/materiales';
import { construirMuros } from './escena/muros';
import { construirCantoPorche, construirSuelos } from './escena/suelos';
import { construirCarpinterias } from './escena/carpinterias';
import { construirEquipamiento } from './escena/equipamiento';
import { obstaculos } from './biblioteca/biblioteca';
import { construirDownlights, construirRodapies } from './escena/detalles';
import { construirPaisaje } from './escena/paisaje';
import { construirLineas } from './escena/lineas';
import { entorno, fondo, sol as crearSol } from './escena/luz';
import { Camarografo, fovPara, type Vista } from './escena/camaras';
import { Estados } from './escena/estados';
import { Navegacion } from './escena/navegacion';
import { construirPiscina, validarPiscina } from './escena/piscina';
import { aplicarVariante, fmtM2 } from './configurador/variantes';
import { Configurador, fmtEuros, fmtPrecio, type Seleccion } from './configurador/configurador';
import { Panel } from './configurador/panel';
import { CATALOGO, PROMOCION, accesoStudio, cargarModelo, catalogoPara, extraerCodigo, resolverAcceso, viviendaPublica, type Modelo } from './promocion/promocion';
import { aplicarMarca } from './promocion/marca';
import { generarPDF } from './documento/pdf';
import './estilos.css';

const $ = <T extends HTMLElement>( s: string ) => document.querySelector( s ) as T;
const CLAVE_ACCESO = 'inmobiliarias:acceso';
const claveSeleccion = ( ref: string ) => `inmobiliarias:seleccion:${ PROMOCION.id }:${ ref }`;
const guardar = ( k: string, v: string | null ) => {

	try {

		if ( v === null ) localStorage.removeItem( k ); else localStorage.setItem( k, v );

	} catch { /* sin almacenamiento local: solo dura la sesión */ }

};

const leer = ( k: string ) => {

	try {

		return localStorage.getItem( k );

	} catch {

		return null;

	}

};

async function iniciar() {

	aplicarMarca( PROMOCION );

	const lienzo = $( '#lienzo' );
	const forzarWebGL = new URLSearchParams( location.search ).has( 'webgl' );
	const renderer = new THREE.WebGPURenderer( { antialias: false, forceWebGL: forzarWebGL } );
	renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );
	renderer.setSize( innerWidth, innerHeight );
	renderer.toneMapping = THREE.NeutralToneMapping;
	renderer.toneMappingExposure = 0.95;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	lienzo.appendChild( renderer.domElement );
	await renderer.init();
	const backend = ( renderer.backend as unknown as { isWebGPUBackend?: boolean } ).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
	$( '#motor' ).textContent = backend;

	const escena = new THREE.Scene();
	escena.backgroundNode = fondo();
	escena.environment = entorno( renderer );

	const camara = new THREE.PerspectiveCamera( 28, innerWidth / innerHeight, 0.05, 200 );
	const ctrl = new OrbitControls( camara, renderer.domElement );
	const nav = new Navegacion( camara, ctrl, renderer.domElement );

	// ---------------------------------------------------------------- acceso
	// Parte pública: plano, vivienda y vistas. Con el enlace privado de una
	// vivienda (#código) se carga esa vivienda y se habilita la personalización.
	const pideStudio = location.hash.startsWith( '#studio' );
	const codigoInicial = ( pideStudio ? '' : extraerCodigo( location.hash ) ) || leer( CLAVE_ACCESO ) || '';
	let comprador: ViviendaPromocion | null = await resolverAcceso( codigoInicial );
	if ( ! comprador && codigoInicial ) guardar( CLAVE_ACCESO, null );
	let fichaVivienda: ViviendaPromocion = comprador ?? viviendaPublica();

	// ---------------------------------------------------------------- modelo
	// Contenedores persistentes: cambiar de distribución o de vivienda solo
	// sustituye su contenido; estados, cámaras y render apuntan a lo mismo.
	let modelo: Modelo = cargarModelo( fichaVivienda.tipologia, fichaVivienda.espejo );
	let conf = new Configurador( catalogoPara( fichaVivienda ), fichaVivienda.precioBase );
	let vivienda: Vivienda = modelo.vivienda;
	const H = modelo.vivienda.alturas.libre.valor;
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
		mobiliario: grupo( 'mobiliario' ), lineas: grupo( 'lineas' ), canto: grupo( 'canto-porche' ), piscina: grupo( 'piscina' ),
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

	const { entorno: suelo } = construirSuelos( modelo.vivienda );
	const luzSol = crearSol( new THREE.Vector3( 6.35, 0, - 3.3 ) );
	escena.add( ...Object.values( c ), suelo!, luzSol, luzSol.target );

	// etiquetas de estancias (modo Plano)
	const etiquetas = new CSS2DRenderer( { element: $( '#etiquetas' ) } );
	etiquetas.setSize( innerWidth, innerHeight );
	const grupoEtiquetas = new THREE.Group();
	escena.add( grupoEtiquetas );
	// escala del plano en pantalla (px por metro): la fija el encuadre de la planta
	let pxPorMetro = 40;
	const construirEtiquetas = () => {

		for ( const o of [ ...grupoEtiquetas.children ] ) grupoEtiquetas.remove( o );
		const extra: Rect[] = conf?.piscina ? [ modelo.tipologia.piscina.rect ] : [];
		const ocupados: Rect[] = [];
		// primero las estancias pequeñas: son las que menos sitio tienen
		for ( const e of [ ...vivienda.estancias ].sort( ( a, b ) => a.superficie - b.superficie ) ) {

			const sup = `${ e.superficie.toLocaleString( 'es-ES', { minimumFractionDigits: 2 } ) } m²`;
			const r = colocarRotulo( e, vivienda, pxPorMetro, sup, extra, ocupados );
			ocupados.push( r.caja );
			const div = document.createElement( 'div' );
			div.className = `etiqueta ${ r.formato === 'solo-nombre-2' ? 'solo-nombre' : r.formato }`;
			const nombre = document.createElement( 'span' );
			nombre.className = 'nombre';
			r.lineas.forEach( ( l, i ) => {

				if ( i ) nombre.append( document.createElement( 'br' ) );
				nombre.append( l );

			} );
			div.title = `${ e.nombre } · ${ sup }`;
			div.append( nombre );
			if ( ! r.formato.startsWith( 'solo' ) ) {

				const s = document.createElement( 'span' );
				s.className = 'sup';
				s.textContent = sup;
				div.append( s );

			}
			const o = new CSS2DObject( div );
			o.position.set( r.x, 0.05, - r.y );
			grupoEtiquetas.add( o );

		}

	};

	/**
	 * Encuadre de la planta: el plano completo (con terraza) en el hueco libre de
	 * la pantalla, sin quedar debajo de la ficha ni de la barra inferior.
	 */
	const encajePlanta = (): Vista => {

		const v = vivienda;
		const xs = [ ...v.muros.flatMap( ( m ) => [ m.rect[ 0 ], m.rect[ 2 ] ] ), ...v.exterior.barandilla.recorrido.map( ( p ) => p[ 0 ] ) ];
		const ys = [ ...v.muros.flatMap( ( m ) => [ m.rect[ 1 ], m.rect[ 3 ] ] ), ...v.exterior.barandilla.recorrido.map( ( p ) => p[ 1 ] ) ];
		const b = [ Math.min( ...xs ) - 0.3, Math.min( ...ys ) - 0.3, Math.max( ...xs ) + 0.3, Math.max( ...ys ) + 0.3 ];
		const bw = b[ 2 ] - b[ 0 ], bh = b[ 3 ] - b[ 1 ];
		const W = innerWidth, H = innerHeight, margen = 24;
		const ficha = $( '.ficha' ).getBoundingClientRect(), dock = $( '.dock' ).getBoundingClientRect();
		const abajo = ( dock.height ? dock.top : H ) - margen;
		const huecos = [ { l: margen, t: margen, r: W - margen, b: abajo } ];
		if ( ficha.width ) huecos.push( { l: ficha.right + margen, t: margen, r: W - margen, b: abajo }, { l: margen, t: ficha.bottom + margen, r: W - margen, b: abajo } );
		// sin ficha visible vale toda la pantalla; con ficha, el mejor de los dos huecos libres
		const candidatos = ficha.width ? huecos.slice( 1 ) : huecos;
		let mejor = candidatos[ 0 ], s = 0;
		for ( const h of candidatos ) {

			const e = Math.min( ( h.r - h.l ) / bw, ( h.b - h.t ) / bh );
			if ( e > s ) {

				s = e; mejor = h;

			}

		}

		const base: Vista = { nombre: 'Planta', pos: [ 0, 0, 0 ], obj: [ 0, 0, 0 ], fov: 28 };
		const f = THREE.MathUtils.degToRad( fovPara( base, W / H ) );
		const alto = H / ( s * 2 * Math.tan( f / 2 ) );
		const dx = ( mejor.l + mejor.r ) / 2 - W / 2, dy = ( mejor.t + mejor.b ) / 2 - H / 2;
		const cx = ( b[ 0 ] + b[ 2 ] ) / 2 - dx / s, cz = - ( b[ 1 ] + b[ 3 ] ) / 2 - dy / s;
		pxPorMetro = s;
		return { ...base, pos: [ cx, alto, cz ], obj: [ cx, 0, cz - 0.02 ] };

	};

	let interiores = vivienda.estancias.filter( ( e ) => e.uso !== 'exterior' );
	const utilInterior = () => interiores.reduce( ( t, x ) => t + x.superficie, 0 );
	const construirLineasActuales = () => volcar( c.lineas, construirLineas( vivienda, { piscina: conf.piscina ? modelo.tipologia.piscina.rect : undefined } ), true );

	/** Reconstruye la vivienda según la distribución elegida. Devuelve el informe de cambios. */
	let estados: Estados | undefined;
	const reconstruir = () => {

		const variante = modelo.variantes.find( ( v ) => v.id === conf.variante ) ?? null;
		const r = aplicarVariante( modelo.vivienda, variante );
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
		s.techos.add( construirDownlights( vivienda ) );
		volcar( c.techos, s.techos );
		volcar( c.volumenes, s.volumenes );
		const k = construirCarpinterias( vivienda );
		volcar( c.carpinterias, k.carpinterias );
		volcar( c.barandilla, k.barandilla );
		const e = construirEquipamiento( vivienda, modelo.ambientacion );
		e.mobiliario.add( ...e.decoracion.children );
		e.fijo.add( Object.assign( construirRodapies( vivienda ), { userData: { x: 6 } } ) );
		// paisaje de zonas comunes: va con el mobiliario para que no aparezca en el plano
		e.mobiliario.add( Object.assign( construirPaisaje( vivienda ), { userData: { x: 13 } } ) );
		volcar( c.fijo, e.fijo );
		volcar( c.mobiliario, e.mobiliario );
		construirLineasActuales();
		construirEtiquetas();
		interiores = vivienda.estancias.filter( ( x ) => x.uso !== 'exterior' );
		nav.actualizarObstaculos( vivienda, obstaculos( modelo.ambientacion ) );
		actualizarFicha();
		estados?.refrescar();
		despertar();
		return r.informe;

	};

	/** Carga (o recarga) la tipología de la vivienda: canto del porche y piscina dependen de la geometría. */
	const cargarGeometriaTipologia = () => {

		volcar( c.canto, construirCantoPorche( modelo.vivienda ) );
		const g = new THREE.Group();
		g.add( construirPiscina( modelo.tipologia.piscina ) );
		volcar( c.piscina, g );
		const fallos = validarPiscina( modelo.tipologia.piscina, modelo.vivienda );
		if ( fallos.length ) console.warn( 'La piscina no cumple:', fallos.join( '; ' ) );

	};

	// ---------------------------------------------------------------- posproceso
	const pipeline = new THREE.RenderPipeline( renderer );
	const escenaPass = pass( escena, camara );
	escenaPass.setMRT( mrt( { output, diffuseColor, normal: packNormalToRGB( normalView ), velocity, metalrough: vec2( metalness, roughness ) } ) );
	const color = escenaPass.getTextureNode( 'output' );
	const difuso = escenaPass.getTextureNode( 'diffuseColor' );
	const profundidad = escenaPass.getTextureNode( 'depth' );
	const normal = escenaPass.getTextureNode( 'normal' );
	const vel = escenaPass.getTextureNode( 'velocity' );
	escenaPass.getTexture( 'diffuseColor' ).type = THREE.UnsignedByteType;
	escenaPass.getTexture( 'normal' ).type = THREE.UnsignedByteType;
	escenaPass.getTexture( 'metalrough' ).type = THREE.UnsignedByteType;
	const metalRugosidad = escenaPass.getTextureNode( 'metalrough' );
	const normalEscena = sample( ( uv ) => unpackRGBToNormal( normal.sample( uv ) ) );
	const gi = ssgi( color, profundidad, normalEscena, camara );
	gi.sliceCount.value = 2;
	gi.stepCount.value = 8;
	gi.radius.value = 4;
	gi.giIntensity.value = 1.6;
	gi.aoIntensity.value = 1.0;
	gi.thickness.value = 0.5;
	// en planta no hay oclusión: el papel queda limpio y sin ruido temporal
	const ao = mix( gi.getAONode(), float( 1 ), M.U.plano );
	const compuesto = vec4( add( color.rgb.mul( ao ), difuso.rgb.mul( gi.getGINode().rgb ) ), color.a );
	// reflejos en espacio de pantalla: suelos, encimeras, sanitarios, cromados.
	// La intensidad sale del brillo de cada material (metales enteros; los
	// dieléctricos, según lo pulidos que estén), con fresnel de ángulo rasante.
	const reflectancia = max( metalRugosidad.r, pow( float( 1 ).sub( metalRugosidad.g ), 3 ).mul( 0.6 ) );
	const reflejos = ssr( color, profundidad, normalEscena, { metalnessNode: reflectancia, roughnessNode: metalRugosidad.g, reflectNonMetals: true, camera: camara } );
	reflejos.resolutionScale = 0.5;
	reflejos.maxDistance.value = 5;
	reflejos.thickness.value = 0.04;
	reflejos.quality.value = 0.45;
	reflejos.intensity.value = 0.85;
	const conReflejos = vec4( compuesto.rgb.add( reflejos.rgb.mul( M.U.plano.oneMinus() ) ), compuesto.a );
	const antialias = traa( conReflejos, profundidad, vel, camara );
	// resplandor suave de ventanas y luminarias, y gradación fotográfica
	const halo = bloom( antialias, 0.09, 0.35, 1.0 );
	const conHalo = antialias.rgb.add( halo.rgb );
	const lum = luminance( conHalo );
	const graduado = mix( vec3( lum ), conHalo, 1.05 ).mul( vec3( 1.004, 1.0, 0.99 ) );
	const r = uv().sub( 0.5 ).mul( vec2( 1.0, 0.8 ) ).length();
	const vineta = float( 1 ).sub( smoothstep( 0.38, 0.85, r ).mul( 0.16 ) );
	pipeline.outputNode = vec4( graduado.mul( vineta ), 1 );

	// Plano: cadena propia sin antialiasing temporal ni iluminación global. Ambos
	// son temporales (varían de un fotograma a otro) y hacían "temblar" los bordes
	// finos del plano; FXAA es espacial y determinista: la imagen queda fija.
	const pipelinePlano = new THREE.RenderPipeline( renderer );
	pipelinePlano.outputColorTransform = false;
	pipelinePlano.outputNode = fxaa( renderOutput( pass( escena, camara ) ) );
	const renderizar = () => ( modo === 'plano' ? pipelinePlano : pipeline ).render();

	// ---------------------------------------------------------------- estados y cámara
	// Internamente se conservan los estados de construcción (la vivienda "se
	// construye" al pasar del plano a la vivienda); la interfaz ofrece tres
	// modos: Plano, Vivienda y Personalizar (este último, solo con acceso).
	estados = new Estados( { volumenes: c.volumenes, lineas: c.lineas, carpinterias: [ c.carpinterias, c.barandilla ], fijo: c.fijo, mobiliario: c.mobiliario, sol: luzSol, escena } );
	const est = estados;
	const cam = new Camarografo( camara, ctrl, $( '#velo' ) );
	cam.reducido = est.reducido;
	// al terminar cada transición se ajusta la navegación a la vista
	cam.alLlegar = ( v ) => nav.configurar( modo === 'plano' ? 'planta' : v.interior ? 'interior' : 'exterior' );
	type Modo = 'plano' | 'vivienda' | 'personalizar';
	let modo: Modo = 'vivienda';

	const botonesModo = [ ...document.querySelectorAll<HTMLButtonElement>( '.modos [data-modo]' ) ];
	const barraVistas = $( '.vistas' );
	let botonesVista: HTMLButtonElement[] = [];
	const actualizarEtiquetas = () => document.body.classList.toggle( 'con-etiquetas', modo === 'plano' );
	const marcarVista = ( k: string ) => botonesVista.forEach( ( b ) => {

		b.setAttribute( 'aria-pressed', String( b.dataset.vista === k ) );
		// con muchas vistas la barra se desplaza: la elegida queda a la vista
		if ( b.dataset.vista === k ) b.scrollIntoView( { block: 'nearest', inline: 'nearest', behavior: est.reducido ? 'auto' : 'smooth' } );

	} );

	/** Mueve la cámara a una vista (una sola vez; si ya está allí no hace nada). */
	const irVista = ( v: string | Vista ) => {

		cam.ir( v );
		marcarVista( typeof v === 'string' ? v : '' );

	};

	/** Barra de vistas guiadas de la tipología cargada. */
	const construirBarraVistas = () => {

		for ( const b of botonesVista ) b.remove();
		const antes = barraVistas.querySelector( '.separador' );
		botonesVista = modelo.tipologia.guiadas.map( ( k ) => {

			const b = document.createElement( 'button' );
			b.type = 'button';
			b.dataset.vista = k;
			b.textContent = modelo.tipologia.vistas[ k ].nombre;
			b.setAttribute( 'aria-pressed', 'false' );
			b.addEventListener( 'click', () => irVista( k ) );
			barraVistas.insertBefore( b, antes );
			return b;

		} );

	};

	const irModo = ( m: Modo ) => {

		if ( m === 'personalizar' && ! comprador ) {

			abrirAcceso();
			return;

		}

		const anterior = modo;
		modo = m;
		document.body.dataset.modo = m;
		botonesModo.forEach( ( b ) => b.setAttribute( 'aria-current', String( b.dataset.modo === m ) ) );
		const n = m === 'plano' ? 1 : 4;
		if ( est.actual !== n ) est.ir( n );
		document.body.dataset.estado = String( n );
		$( '#configurador' ).hidden = m !== 'personalizar';
		actualizarEtiquetas();
		if ( m === 'plano' ) {

			( modelo.tipologia.vistas as Record<string, Vista> ).planta = encajePlanta();
			construirEtiquetas();
			irVista( 'planta' );
			return;

		}

		// al salir del plano se vuelve a la vista general; entre Vivienda y
		// Personalizar la cámara no se mueve
		if ( anterior === 'plano' ) irVista( 'aerea' );

	};

	botonesModo.forEach( ( b ) => b.addEventListener( 'click', () => irModo( b.dataset.modo as Modo ) ) );
	addEventListener( 'keydown', ( ev ) => {

		const t = ev.target as HTMLElement | null;
		if ( t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.closest?.( '#configurador, dialog' ) ) return;
		const modos: Record<string, Modo> = { 1: 'plano', 2: 'vivienda', 3: 'personalizar' };
		if ( modos[ ev.key ] ) irModo( modos[ ev.key ] );
		if ( ev.key === 'Escape' ) $( '#captura' ).hidden = true;

	} );
	$( '#recentrar' ).addEventListener( 'click', () => {

		cam.ir( modo === 'plano' ? 'planta' : cam.ultima );
		marcarVista( modo === 'plano' ? '' : cam.ultima );

	} );
	ctrl.addEventListener( 'start', () => {

		cam.soltar();
		marcarVista( '' );

	} );

	// ---------------------------------------------------------------- ficha
	function actualizarFicha() {

		const t = modelo.tipologia;
		const v = fichaVivienda;
		$( '#ficha-vivienda' ).textContent = comprador ? `${ v.ref } · ${ t.nombre }` : t.nombre;
		$( '#ficha-datos' ).textContent = `${ t.dormitorios } dormitorios · ${ t.banos } baños · ${ fmtM2( utilInterior() ) } útiles · terraza y porche de ${ fmtM2( v.superficies.exterior ) }`;
		document.body.classList.toggle( 'comprador', !! comprador );

	}

	// ---------------------------------------------------------------- personalizar
	const guardarSeleccion = () => comprador && guardar( claveSeleccion( comprador.ref ), JSON.stringify( conf.seleccion ) );

	const vistaDeVariante = () => ( modelo.variantes.find( ( v ) => v.id === conf.variante ) ?? modelo.variantes[ 0 ] )?.vista ?? null;
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

	aviso.addEventListener( 'pointerenter', () => clearTimeout( temporizadorAviso ) );
	aviso.addEventListener( 'pointerleave', () => ( temporizadorAviso = window.setTimeout( () => ( aviso.hidden = true ), 4000 ) ) );

	/**
	 * Aplica una opción: modelo 3D, precio y vista. `moverCamara` = false cuando
	 * la opción se quita desde el resumen (el cambio no debe arrastrar la cámara).
	 */
	const aplicarOpcion = ( categoria: string, opcion: string, moverCamara = true ) => {

		const cat = conf.categoria( categoria );
		const anterior = conf.elegir( categoria, opcion );
		const nueva = conf.opcion( categoria );
		if ( categoria === 'distribucion' && anterior.variante !== nueva.variante ) {

			const informe = reconstruir();
			const variante = modelo.variantes.find( ( v ) => v.id === nueva.variante );
			panel.informe( 'distribucion', variante ? [ variante.descripcion, ...informe ] : [] );
			avisar( variante ? variante.resumen : 'Distribución base: salón y cocina vuelven a estar separados.', {
				etiqueta: 'Ver en plano', hacer: () => irModo( 'plano' ),
			} );

		}

		if ( categoria === 'exterior' ) construirLineasActuales();
		const activa = nueva.precio > 0 || !! nueva.piscina;
		const v = vistaDeCategoria( categoria );
		if ( moverCamara && v && ( ! cat.soloAlActivar || activa ) ) irVista( v );
		panel.resumen();
		guardarSeleccion();
		despertar();

	};

	let panel = crearPanel();
	function crearPanel() {

		return new Panel( conf, {
			abrir( categoria ) {

				// al desplegar una categoría se enseña la estancia a la que afecta
				const v = vistaDeCategoria( categoria );
				if ( v ) irVista( v );

			},
			elegir: ( categoria, opcion ) => aplicarOpcion( categoria, opcion ),
			quitar: ( categoria ) => aplicarOpcion( categoria, conf.base( categoria ).id, false ),
			restablecer: () => {

				for ( const x of conf.extras ) aplicarOpcion( x.categoria.id, conf.base( x.categoria.id ).id, false );
				panel.sincronizar();

			},
			cerrar: () => irModo( 'vivienda' ),
			generar: () => mostrarResumen(),
		} );

	}

	/** Carga una vivienda (y su tipología) sin recargar la página. */
	const cargarVivienda = ( v: ViviendaPromocion ) => {

		const cambiaGeometria = v.tipologia !== fichaVivienda.tipologia || v.espejo !== fichaVivienda.espejo;
		fichaVivienda = v;
		if ( cambiaGeometria ) {

			modelo = cargarModelo( v.tipologia, v.espejo );
			cargarGeometriaTipologia();

		}

		cam.vistas = modelo.tipologia.vistas;
		construirBarraVistas();
		conf = new Configurador( catalogoPara( v ), v.precioBase );
		for ( const k of conf.datos.categorias ) conf.aplicarParametros( k.id, true );
		// selección anterior de esta vivienda en este navegador (comodidad, no se envía a ningún sitio)
		if ( comprador ) {

			try {

				const s = JSON.parse( leer( claveSeleccion( v.ref ) ) ?? 'null' ) as Seleccion | null;
				if ( s ) conf.restaurar( s );

			} catch { /* selección ilegible: se empieza desde lo incluido */ }

		}

		panel.destruir();
		panel = crearPanel();
		panel.desplegar( 'distribucion', false );
		const variante = modelo.variantes.find( ( x ) => x.id === conf.variante );
		const informe = reconstruir();
		if ( variante ) panel.informe( 'distribucion', [ variante.descripcion, ...informe ] );
		panel.resumen();

	};

	// ---------------------------------------------------------------- acceso de comprador
	const dialogoAcceso = $<HTMLDialogElement>( '#acceso' );
	const campoAcceso = $<HTMLInputElement>( '#codigo-acceso' );
	function abrirAcceso() {

		$( '#acceso .error' ).hidden = true;
		campoAcceso.value = '';
		dialogoAcceso.showModal();

	}

	$( '#abrir-acceso' ).addEventListener( 'click', abrirAcceso );
	$( '#acceso .cancelar' ).addEventListener( 'click', () => dialogoAcceso.close() );
	$( '#acceso form' ).addEventListener( 'submit', async ( ev ) => {

		ev.preventDefault();
		const v = await resolverAcceso( campoAcceso.value );
		if ( ! v ) {

			$( '#acceso .error' ).hidden = false;
			campoAcceso.focus();
			return;

		}

		comprador = v;
		guardar( CLAVE_ACCESO, extraerCodigo( campoAcceso.value ) );
		dialogoAcceso.close();
		cargarVivienda( v );
		irModo( 'personalizar' );

	} );
	$( '#salir-comprador' ).addEventListener( 'click', () => {

		comprador = null;
		guardar( CLAVE_ACCESO, null );
		if ( location.hash ) history.replaceState( null, '', location.pathname + location.search );
		cargarVivienda( viviendaPublica() );
		irModo( 'vivienda' );

	} );

	// ---------------------------------------------------------------- documento de selección
	const dialogo = $<HTMLDialogElement>( '#resumen-configuracion' );
	const mostrarResumen = () => {

		const filas = conf.datos.categorias.map( ( k ) => {

			const o = conf.opcion( k.id );
			return `<tr><th scope="row">${ k.nombre }</th><td>${ o.nombre }${ o.detalle ? ` <span class="detalle">(${ o.detalle })</span>` : '' }</td><td>${ fmtPrecio( o.precio ) }</td></tr>`;

		} ).join( '' );
		dialogo.querySelector( '.contenido' )!.innerHTML = `
			<p class="fecha">${ PROMOCION.promocion.nombre } · ${ fichaVivienda.ref } · ${ modelo.tipologia.nombre }</p>
			<table>
				<tbody>${ filas }</tbody>
				<tfoot>
					<tr><th scope="row">Precio base vivienda</th><td></td><td>${ fmtEuros( conf.precioBase ) }</td></tr>
					<tr><th scope="row">Mejoras (${ conf.extras.length })</th><td></td><td>+${ fmtEuros( conf.totalExtras ) }</td></tr>
					<tr class="total"><th scope="row">Precio total</th><td></td><td>${ fmtEuros( conf.total ) }</td></tr>
				</tfoot>
			</table>
			<p class="nota">El documento incluye una imagen de tu vivienda configurada y un apartado para tu firma. Descárgalo, fírmalo y envíalo a tu comercial para confirmar tu selección.</p>`;
		dialogo.showModal();

	};

	dialogo.querySelector( '.seguir' )!.addEventListener( 'click', () => dialogo.close() );
	dialogo.querySelector( '.cerrar-dialogo' )!.addEventListener( 'click', () => {

		dialogo.close();
		irModo( 'vivienda' );

	} );

	// Publicado en claude.ai, las descargas pasan por el capability `downloads`
	// (el visor bloquea los enlaces de descarga normales). En local, enlace normal.
	type Descargas = { save( r: { filename: string; data: Blob } ): Promise<unknown> } | null;
	const rt = ( window as unknown as { claude?: { use( n: string ): Promise<unknown> } } ).claude;
	let descargas: Descargas = null;
	rt?.use?.( 'downloads' ).then( ( d ) => ( descargas = d as Descargas ), () => {} );
	const descargar = async ( nombre: string, blob: Blob ) => {

		if ( descargas ) {

			await descargas.save( { filename: nombre, data: blob } ).catch( () => {} );
			return;

		}

		const a = document.createElement( 'a' );
		a.href = URL.createObjectURL( blob );
		a.download = nombre;
		a.click();
		setTimeout( () => URL.revokeObjectURL( a.href ), 5000 );

	};

	dialogo.querySelector( '.descargar-pdf' )!.addEventListener( 'click', async ( ev ) => {

		const b = ev.currentTarget as HTMLButtonElement;
		b.disabled = true;
		b.textContent = 'Preparando documento…';
		try {

			const imagen = await renderizarVista( 'aerea', 1800, 40 );
			const vistaVariante = conf.variante ? vistaDeVariante() : null;
			const imagenDistribucion = vistaVariante ? await renderizarVista( vistaVariante, 1400, 32 ) : null;
			const blob = await generarPDF( {
				promocion: PROMOCION, vivienda: fichaVivienda, tipologia: modelo.tipologia, conf,
				superficieUtil: utilInterior(), imagen, imagenDistribucion,
				tituloDistribucion: vistaVariante?.nombre ?? null,
			} );
			const fecha = new Date().toISOString().slice( 0, 10 );
			await descargar( `seleccion-${ fichaVivienda.ref.toLowerCase().replace( /[^a-z0-9]+/g, '-' ) }-${ fecha }.pdf`, blob );

		} catch ( e ) {

			console.error( e );
			avisar( 'No se ha podido generar el documento. Inténtalo de nuevo.' );

		} finally {

			b.disabled = false;
			b.textContent = 'Descargar PDF';

		}

	} );

	// ---------------------------------------------------------------- imágenes con encuadre maestro
	/**
	 * Renderiza una vista maestra a alta resolución y devuelve un JPEG/PNG.
	 * La cámara vuelve después exactamente a donde estaba.
	 */
	let capturando = false;
	async function renderizarVista( vista: string | Vista | null, ancho: number, fotogramas: number, tipo = 'image/jpeg' ) {

		capturando = true;
		const velo = $( '#preparando' );
		velo.hidden = false;
		const antes = { pos: camara.position.clone(), obj: ctrl.target.clone(), fov: camara.fov, actual: cam.actual };
		const ratio = renderer.getPixelRatio();
		try {

			if ( vista ) cam.ir( vista, true );
			camara.filmOffset = 0;
			camara.zoom = 1;
			camara.updateProjectionMatrix();
			renderer.setPixelRatio( Math.min( 3, ancho / innerWidth ) );
			gi.sliceCount.value = 3;
			gi.stepCount.value = 16;
			for ( let i = 0; i < fotogramas; i ++ ) {

				renderizar();
				if ( i % 8 === 0 ) await new Promise( requestAnimationFrame );

			}

			renderizar();
			return renderer.domElement.toDataURL( tipo, 0.9 );

		} finally {

			renderer.setPixelRatio( ratio );
			gi.sliceCount.value = 2;
			gi.stepCount.value = 8;
			camara.position.copy( antes.pos );
			ctrl.target.copy( antes.obj );
			camara.fov = antes.fov;
			camara.updateProjectionMatrix();
			ctrl.update();
			cam.actual = antes.actual;
			velo.hidden = true;
			capturando = false;
			despertar();

		}

	}

	$( '#foto' ).addEventListener( 'click', async () => {

		const boton = $<HTMLButtonElement>( '#foto' );
		boton.disabled = true;
		const url = await renderizarVista( null, 2400, 72, 'image/png' );
		boton.disabled = false;
		$<HTMLImageElement>( '#captura img' ).src = url;
		const enlace = $<HTMLAnchorElement>( '#captura a' );
		enlace.href = url;
		enlace.download = `${ PROMOCION.promocion.nombre }-${ cam.actual || 'vista' }.png`.toLowerCase().replace( /\s+/g, '-' );
		$( '#captura' ).hidden = false;

	} );
	$( '#captura a' ).addEventListener( 'click', async ( ev ) => {

		if ( ! descargas ) return; // sin capability: el enlace normal hace la descarga
		ev.preventDefault();
		const a = ev.currentTarget as HTMLAnchorElement;
		await descargar( a.download, await ( await fetch( a.href ) ).blob() );

	} );
	$( '#captura button' ).addEventListener( 'click', () => ( $( '#captura' ).hidden = true ) );

	// ---------------------------------------------------------------- bucle
	addEventListener( 'resize', () => {

		camara.aspect = innerWidth / innerHeight;
		camara.updateProjectionMatrix();
		if ( modo === 'plano' ) {

			( modelo.tipologia.vistas as Record<string, Vista> ).planta = encajePlanta();
			construirEtiquetas();
			cam.ir( 'planta', true );

		} else cam.reencuadrar();
		renderer.setSize( innerWidth, innerHeight );
		etiquetas.setSize( innerWidth, innerHeight );

	} );

	// Con el cajón abierto, la composición maestra se encaja entera en el hueco
	// libre: se reduce la imagen (zoom) y se desplaza su centro (filmOffset). La
	// cámara no cambia: misma posición, objetivo y fov. (No se usa setViewOffset
	// porque el antialiasing temporal lo reescribe en cada fotograma.)
	let desplazamiento = 0;
	const encuadrar = ( d: number ) => {

		const W = innerWidth;
		const zoom = d < 0.5 ? 1 : ( W - d ) / W;
		const tan = Math.tan( THREE.MathUtils.degToRad( camara.fov / 2 ) );
		const film = d < 0.5 ? 0 : camara.getFilmWidth() * ( d / W ) * tan * camara.aspect / zoom;
		if ( camara.zoom !== zoom || camara.filmOffset !== film ) {

			camara.zoom = zoom;
			camara.filmOffset = film;
			camara.updateProjectionMatrix();

		}

	};

	// Render bajo demanda: con todo quieto se acumulan unos fotogramas (el
	// antialiasing temporal converge) y la imagen se congela. Sin esto, el
	// vaivén de subpíxel del antialiasing hace "temblar" los bordes finos del
	// plano. Cualquier interacción o animación vuelve a activar el render.
	const FOTOGRAMAS_ESTABLES = Number( new URLSearchParams( location.search ).get( 'estables' ) ) || 48;
	let quietos = 0;
	const despertar = () => ( quietos = 0 );
	for ( const ev of [ 'pointerdown', 'wheel', 'keydown', 'click', 'resize' ] ) addEventListener( ev, despertar, { passive: true } );
	addEventListener( 'pointermove', ( e ) => e.buttons && despertar(), { passive: true } );
	const matAnterior = new THREE.Matrix4(), proyAnterior = new THREE.Matrix4();

	let diagnostico: Record<string, unknown> = {};
	let pausado = false;
	let exposicion = renderer.toneMappingExposure;
	let piscinaT = conf.piscina ? 1 : 0;
	renderer.setAnimationLoop( ( t ) => {

		if ( pausado || capturando ) return;
		est.actualizar( t );
		cam.actualizar( performance.now() );
		const orbitando = ctrl.update();
		nav.restringir( cam.animando || capturando );
		// plano cercano según la altura: más precisión de profundidad en vistas lejanas
		const near = THREE.MathUtils.clamp( ( camara.position.y - 2.5 ) * 0.04, 0.05, 1.2 );
		if ( Math.abs( camara.near - near ) > 1e-3 ) {

			camara.near = near;
			camara.updateProjectionMatrix();

		}

		// dentro de la vivienda los techos proyectan sombra; en la maqueta no
		const bajo = camara.position.y < H + 0.2;
		for ( const tc of c.techos.children ) tc.castShadow = bajo || tc.userData.porche;
		c.techos.visible = est.valores.muros > 0.98;
		c.canto.visible = bajo && c.techos.visible;
		conf.actualizar( performance.now() );
		const objetivo = modo === 'personalizar' && innerWidth > 760 ? innerWidth - $( '#configurador' ).getBoundingClientRect().left : 0;
		desplazamiento += ( objetivo - desplazamiento ) * ( est.reducido ? 1 : 0.2 );
		if ( Math.abs( objetivo - desplazamiento ) < 0.5 ) desplazamiento = objetivo;
		encuadrar( desplazamiento );
		// piscina: aparece con el equipamiento (vivienda terminada) si está elegida
		piscinaT += ( ( conf.piscina ? 1 : 0 ) - piscinaT ) * ( est.reducido ? 1 : 0.08 );
		if ( Math.abs( piscinaT - ( conf.piscina ? 1 : 0 ) ) < 0.002 ) piscinaT = conf.piscina ? 1 : 0;
		const ep = piscinaT * est.valores.fijo;
		c.piscina.visible = ep > 0.003;
		c.piscina.scale.y = Math.max( 0.001, ep );
		// exposición automática: dentro de la vivienda se abre el "diafragma"
		const dentro = bajo && interiores.some( ( e ) => puntoEnPoligono( camara.position.x, - camara.position.z, e.poligono ) );
		const expObjetivo = dentro ? 1.45 : 0.95;
		exposicion = Math.abs( expObjetivo - exposicion ) < 0.001 ? expObjetivo : exposicion + ( expObjetivo - exposicion ) * 0.06;
		renderer.toneMappingExposure = exposicion;

		camara.updateMatrixWorld();
		const cambia = orbitando || nav.activo || cam.animando || est.animando || conf.animando
			|| ! matAnterior.equals( camara.matrixWorld ) || ! proyAnterior.equals( camara.projectionMatrix )
			|| exposicion !== expObjetivo || desplazamiento !== objetivo || ( piscinaT !== 0 && piscinaT !== 1 );
		matAnterior.copy( camara.matrixWorld );
		proyAnterior.copy( camara.projectionMatrix );
		quietos = cambia ? 0 : quietos + 1;
		diagnostico = { orbitando, cam: cam.animando, est: est.animando, conf: conf.animando, mat: ! matAnterior.equals( camara.matrixWorld ), exposicion, expObjetivo, desplazamiento, objetivo, piscinaT, quietos };
		if ( quietos > FOTOGRAMAS_ESTABLES ) return; // imagen estable: no se vuelve a pintar
		renderizar();
		etiquetas.render( escena, camara );

	} );

	// ---------------------------------------------------------------- arranque
	cargarGeometriaTipologia();
	cargarVivienda( fichaVivienda );
	cam.ir( 'aerea', true );
	marcarVista( 'aerea' );
	irModo( 'vivienda' );
	document.body.classList.add( 'listo' );
	if ( comprador ) avisar( `Bienvenido. Estás viendo tu vivienda ${ comprador.ref }. Pulsa Personalizar para elegir tus acabados.` );

	// ---------------------------------------------------------------- studio (producción)
	// Chunk aparte, solo con código: la experiencia pública y la del comprador
	// no cargan nada del Studio.
	const dialogoStudio = $<HTMLDialogElement>( '#acceso-studio' );
	const abrirStudio = async () => {

		const { abrirStudio: abrir } = await import( './studio/studio' );
		await abrir( {
			escena, camara, ctrl, lienzo: renderer.domElement, mobiliario: c.mobiliario,
			modelo: () => modelo, espejo: () => !! fichaVivienda.espejo,
			reconstruir: () => void reconstruir(), despertar, irVista, construirBarraVistas,
			refrescarCatalogo: () => cargarVivienda( fichaVivienda ),
			aplicarMarca: () => {

				aplicarMarca( PROMOCION );
				actualizarFicha();

			},
			promocion: PROMOCION, catalogo: CATALOGO, descargar, avisar: ( t ) => avisar( t ),
		} );

	};
	// en este navegador se recuerda el acceso (solo el código ya validado)
	const CLAVE_STUDIO = 'inmobiliarias:studio';
	const pedirStudio = async ( codigo?: string ) => {

		if ( document.body.classList.contains( 'en-studio' ) ) return;
		codigo ||= leer( CLAVE_STUDIO ) ?? '';
		if ( codigo && await accesoStudio( codigo ) ) {

			guardar( CLAVE_STUDIO, codigo );
			return abrirStudio();

		}
		$( '#acceso-studio .error' ).hidden = true;
		$<HTMLInputElement>( '#codigo-studio' ).value = '';
		dialogoStudio.showModal();

	};
	dialogoStudio.querySelector( '.cancelar' )!.addEventListener( 'click', () => dialogoStudio.close() );
	dialogoStudio.querySelector( 'form' )!.addEventListener( 'submit', async ( ev ) => {

		ev.preventDefault();
		const codigo = $<HTMLInputElement>( '#codigo-studio' ).value.trim();
		if ( await accesoStudio( codigo ) ) {

			guardar( CLAVE_STUDIO, codigo );
			dialogoStudio.close();
			void abrirStudio();

		} else $( '#acceso-studio .error' ).hidden = false;

	} );
	$( '#abrir-studio' ).addEventListener( 'click', () => void pedirStudio() );
	if ( pideStudio ) void pedirStudio( location.hash.replace( /^#studio-?/, '' ) );
	addEventListener( 'hashchange', () => location.hash.startsWith( '#studio' ) && void pedirStudio( location.hash.replace( /^#studio-?/, '' ) ) );

	Object.assign( window, { __vivienda: { nav, irModo, irEstado: ( n: number ) => irModo( n === 1 ? 'plano' : 'vivienda' ), cam, estados: est, renderer, camara, ctrl, pausar: ( p: boolean ) => ( pausado = p ), diagnostico: () => diagnostico } } );

}

iniciar().catch( ( err ) => {

	console.error( err );
	$( '#carga' ).textContent = 'No se ha podido iniciar el visor 3D en este navegador.';

} );

