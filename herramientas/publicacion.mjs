#!/usr/bin/env node
// Publicación de promociones: construir, publicar una versión numerada y volver atrás.
//
// Es la lógica estable que hay debajo de las recetas 9 (preview), 10 (publicar) y
// 11 (volver a una versión anterior). Hoy la ejecuta Claude; más adelante la
// ejecutará el «brazo ejecutor» (GitHub Actions) cuando pulses el botón del Panel.
// Las garantías son las mismas en ambos casos porque las comprueba este script.
//
//   node herramientas/publicacion.mjs construir <promoción>
//   node herramientas/publicacion.mjs publicar  <promoción> --aprobado-por "Nombre" --cambios "Texto" [--confirmar]
//   node herramientas/publicacion.mjs volver    <promoción> <vN> --motivo "Texto" [--confirmar]
//   node herramientas/publicacion.mjs estado    <promoción>
//   node herramientas/publicacion.mjs indice    (regenera publico/promociones.json para el Panel)
//
// Opciones comunes: --escaparate <ruta> (por defecto ../escaparate).
// Sin --confirmar, publicar y volver solo muestran lo que harían (no cambian nada).
//
// Reglas que garantiza:
//  - la web pública se construye SIN Studio y se comprueba que no lo contiene;
//  - ningún archivo con forma de secreto llega al escaparate;
//  - cada publicación es una versión numerada (v1, v2…) que fija el commit exacto
//    del taller (producto maestro + datos) con una etiqueta inmutable;
//  - nunca se borra una versión: volver atrás restaura una anterior y marca la
//    vigente como «retirada»;
//  - publicar exige el taller sin cambios pendientes (lo publicado = lo guardado);
//  - no se envía nada a GitHub: el envío (push) es un paso aparte y explícito.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const SALIDA = join( RAIZ, 'salida' );
// en el escaparate, lo que Cloudflare sirve vive en publico/<promoción>/
const PUBLICO = 'publico';

// límites de Cloudflare (archivos estáticos)
const MAX_ARCHIVO = 25 * 1024 * 1024;
const MAX_ARCHIVOS = 20000;

// rastros del Studio que nunca deben aparecer en la web pública
const MARCAS_STUDIO = [ 'Interiorismo IA', 'st-ayuda', 'abrirStudio' ];

// formas típicas de credenciales (Supabase, GitHub, Cloudflare, AWS, claves privadas…)
const SECRETOS = [
	/sb_secret_[A-Za-z0-9_-]{10,}/,
	/service_role/,
	/gh[pousr]_[A-Za-z0-9]{30,}/,
	/github_pat_[A-Za-z0-9_]{30,}/,
	/AKIA[0-9A-Z]{16}/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/SUPABASE_SERVICE/,
];

// ---------------------------------------------------------------- utilidades

const args = process.argv.slice( 2 );
const opcion = ( nombre ) => {

	const i = args.indexOf( `--${ nombre }` );
	return i >= 0 ? args[ i + 1 ] : undefined;

};
const bandera = ( nombre ) => args.includes( `--${ nombre }` );
const CON_VALOR = [ '--escaparate', '--aprobado-por', '--cambios', '--motivo' ];
const posicionales = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! CON_VALOR.includes( args[ i - 1 ] ) );

const fallo = ( texto ) => {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

};
const ok = ( texto ) => console.log( `✓ ${ texto }` );
const git = ( cwd, ...a ) => execFileSync( 'git', a, { cwd, encoding: 'utf8' } ).trim();
const hoy = () => new Date().toISOString().slice( 0, 19 ) + 'Z';

const leerJSON = ( ruta, defecto ) => ( existsSync( ruta ) ? JSON.parse( readFileSync( ruta, 'utf8' ) ) : defecto );
const escribirJSON = ( ruta, datos ) => writeFileSync( ruta, JSON.stringify( datos, null, 2 ) + '\n' );

function comprobarPromocion( id ) {

	if ( ! id ) fallo( 'Falta la promoción. Ejemplo: residencial-demo' );
	if ( ! /^[a-z0-9-]+$/.test( id ) ) fallo( `Identificador de promoción no válido: «${ id }»` );
	if ( ! existsSync( join( RAIZ, 'promociones', id, 'promocion.json' ) ) ) fallo( `No existe promociones/${ id }/promocion.json` );

}

const rutaRegistro = ( id ) => join( RAIZ, 'promociones', id, 'publicaciones.json' );
const leerRegistro = ( id ) => leerJSON( rutaRegistro( id ), { promocion: id, versiones: [] } );

function rutaEscaparate() {

	const ruta = resolve( opcion( 'escaparate' ) ?? join( RAIZ, '..', 'escaparate' ) );
	if ( ! existsSync( join( ruta, '.git' ) ) ) fallo( `No encuentro el escaparate en ${ ruta } (usa --escaparate <ruta>)` );
	return ruta;

}

function listar( dir ) {

	return readdirSync( dir, { withFileTypes: true } ).flatMap( ( e ) => ( e.isDirectory() ? listar( join( dir, e.name ) ) : [ join( dir, e.name ) ] ) );

}

// ---------------------------------------------------------------- construir

function construir( id ) {

	comprobarPromocion( id );
	const destino = join( SALIDA, id );
	rmSync( destino, { recursive: true, force: true } );
	console.log( `Construyendo «${ id }» (web pública, sin Studio)…` );
	execFileSync( 'npx', [ 'tsc', '--noEmit' ], { cwd: RAIZ, stdio: 'inherit' } );
	execFileSync( 'npx', [ 'vite', 'build', '--logLevel', 'warn' ], { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, PROMOCION: id, SALIDA: destino } } );
	ok( 'Comprobación de tipos y construcción' );

	const archivos = listar( destino );
	if ( ! existsSync( join( destino, 'index.html' ) ) ) fallo( 'La construcción no ha generado index.html' );
	if ( archivos.length > MAX_ARCHIVOS ) fallo( `Demasiados archivos (${ archivos.length } > ${ MAX_ARCHIVOS })` );
	let total = 0;
	for ( const a of archivos ) {

		const tam = statSync( a ).size;
		total += tam;
		if ( tam > MAX_ARCHIVO ) fallo( `Archivo demasiado grande para Cloudflare: ${ relative( destino, a ) } (${ ( tam / 1048576 ).toFixed( 1 ) } MB)` );
		if ( ! /\.(html|js|css|json|svg|txt)$/.test( a ) ) continue;
		const texto = readFileSync( a, 'utf8' );
		for ( const m of MARCAS_STUDIO ) if ( texto.includes( m ) ) fallo( `La web pública contiene código del Studio («${ m }» en ${ relative( destino, a ) })` );
		for ( const s of SECRETOS ) if ( s.test( texto ) ) fallo( `Posible secreto en ${ relative( destino, a ) } (${ s })` );

	}

	ok( `Sin Studio y sin secretos · ${ archivos.length } archivos · ${ ( total / 1048576 ).toFixed( 1 ) } MB` );
	return { destino, archivos: archivos.length, bytes: total };

}

// ---------------------------------------------------------------- índice para el Panel

// publico/promociones.json: qué promociones hay en esta rama del escaparate y en
// qué versión. El Panel lo lee de producción y de la vista previa para saber qué
// está publicado y qué espera revisión. Solo datos que ya son públicos.
function actualizarIndice( esc ) {

	const base = join( esc, PUBLICO );
	const promociones = readdirSync( base, { withFileTypes: true } )
		.filter( ( e ) => e.isDirectory() && existsSync( join( base, e.name, 'version.json' ) ) )
		.map( ( e ) => {

			const v = JSON.parse( readFileSync( join( base, e.name, 'version.json' ), 'utf8' ) );
			const datos = join( RAIZ, 'promociones', e.name, 'promocion.json' );
			const p = existsSync( datos ) ? JSON.parse( readFileSync( datos, 'utf8' ) ).promocion ?? {} : {};
			return { id: e.name, nombre: p.nombre ?? e.name, ubicacion: p.ubicacion ?? '', version: v.version, fecha: v.fecha };

		} )
		.sort( ( a, b ) => a.id.localeCompare( b.id ) );
	escribirJSON( join( base, 'promociones.json' ), { actualizado: hoy(), promociones } );
	git( esc, 'add', join( PUBLICO, 'promociones.json' ) );

}

// ---------------------------------------------------------------- publicar

function publicar( id ) {

	comprobarPromocion( id );
	const esc = rutaEscaparate();
	const aprobadoPor = opcion( 'aprobado-por' );
	const cambios = opcion( 'cambios' );
	if ( ! aprobadoPor ) fallo( 'Falta --aprobado-por: ninguna publicación sin aprobación explícita' );
	if ( ! cambios ) fallo( 'Falta --cambios: cada versión debe explicar qué cambia' );
	if ( git( RAIZ, 'status', '--porcelain' ) ) fallo( 'El taller tiene cambios sin guardar. Lo publicado debe ser exactamente lo guardado (haz commit primero).' );
	if ( git( esc, 'status', '--porcelain' ) ) fallo( 'El escaparate tiene cambios sin guardar.' );

	const registro = leerRegistro( id );
	const numero = registro.versiones.reduce( ( m, v ) => Math.max( m, Number( v.version.slice( 1 ) ) ), 0 ) + 1;
	const version = `v${ numero }`;
	const motor = git( RAIZ, 'rev-parse', 'HEAD' );
	const etiqueta = `${ id }/${ version }`;
	if ( git( RAIZ, 'tag', '--list', etiqueta ) ) fallo( `La etiqueta ${ etiqueta } ya existe en el taller` );

	console.log( `\nPublicación de «${ id }» ${ version }` );
	console.log( `  commit del taller: ${ motor.slice( 0, 10 ) }` );
	console.log( `  aprobado por:      ${ aprobadoPor }` );
	console.log( `  cambios:           ${ cambios }\n` );

	const { destino, archivos, bytes } = construir( id );
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha publicado nada. Repite con --confirmar para publicar.\n' );
		return;

	}

	// escaparate: sustituye la carpeta de la promoción por la nueva versión
	const carpeta = join( esc, PUBLICO, id );
	rmSync( carpeta, { recursive: true, force: true } );
	mkdirSync( carpeta, { recursive: true } );
	cpSync( destino, carpeta, { recursive: true } );
	const fecha = hoy();
	escribirJSON( join( carpeta, 'version.json' ), { promocion: id, version, fecha, taller: motor } );
	git( esc, 'add', '-A', join( PUBLICO, id ) );
	actualizarIndice( esc );
	git( esc, 'commit', '-q', '-m', `Publica ${ id } ${ version }\n\n${ cambios }\nAprobado por: ${ aprobadoPor }\nTaller: ${ motor }` );
	git( esc, 'tag', '-a', etiqueta, '-m', `${ id } ${ version } · ${ fecha }` );
	ok( `Escaparate: ${ PUBLICO }/${ id }/ actualizado y etiquetado ${ etiqueta }` );

	// taller: etiqueta inmutable en el commit publicado + registro de versiones
	git( RAIZ, 'tag', '-a', etiqueta, motor, '-m', `${ id } ${ version } · ${ fecha }` );
	for ( const v of registro.versiones ) if ( v.estado === 'publicada' ) v.estado = 'sustituida';
	registro.versiones.push( { version, fecha, estado: 'publicada', taller: motor, aprobadoPor, cambios, archivos, bytes } );
	registro.historial = [ ...( registro.historial ?? [] ), { fecha, accion: 'publicar', version, por: aprobadoPor } ];
	escribirJSON( rutaRegistro( id ), registro );
	git( RAIZ, 'add', rutaRegistro( id ) );
	git( RAIZ, 'commit', '-q', '-m', `Registro: ${ id } ${ version } publicada` );
	ok( `Taller: etiqueta ${ etiqueta } y registro de versiones actualizado` );
	console.log( '\nFalta enviar a GitHub (push) el taller, el escaparate y sus etiquetas.\n' );

}

// ---------------------------------------------------------------- volver a una versión anterior

function volver( id, version ) {

	comprobarPromocion( id );
	const esc = rutaEscaparate();
	const motivo = opcion( 'motivo' );
	if ( ! /^v\d+$/.test( version ?? '' ) ) fallo( 'Indica la versión, por ejemplo: v2' );
	if ( ! motivo ) fallo( 'Falta --motivo' );
	if ( git( RAIZ, 'status', '--porcelain' ) || git( esc, 'status', '--porcelain' ) ) fallo( 'Hay cambios sin guardar en el taller o el escaparate.' );

	const registro = leerRegistro( id );
	const destinoV = registro.versiones.find( ( v ) => v.version === version );
	const vigente = registro.versiones.find( ( v ) => v.estado === 'publicada' );
	if ( ! destinoV ) fallo( `No existe la versión ${ version } de ${ id }` );
	if ( vigente?.version === version ) fallo( `${ version } ya es la versión publicada` );
	const etiqueta = `${ id }/${ version }`;
	if ( ! git( esc, 'tag', '--list', etiqueta ) ) fallo( `El escaparate no tiene la etiqueta ${ etiqueta }` );

	console.log( `\nVolver «${ id }» de ${ vigente?.version ?? '—' } a ${ version }\n  motivo: ${ motivo }` );
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha cambiado nada. Repite con --confirmar.\n' );
		return;

	}

	const fecha = hoy();
	git( esc, 'rm', '-r', '-q', '--ignore-unmatch', join( PUBLICO, id ) );
	git( esc, 'checkout', etiqueta, '--', join( PUBLICO, id ) );
	actualizarIndice( esc );
	git( esc, 'commit', '-q', '-m', `Vuelve ${ id } a ${ version }\n\nMotivo: ${ motivo }` );
	ok( `Escaparate: ${ PUBLICO }/${ id }/ restaurado a ${ version }` );

	if ( vigente ) vigente.estado = 'retirada';
	destinoV.estado = 'publicada';
	registro.historial = [ ...( registro.historial ?? [] ), { fecha, accion: 'volver', desde: vigente?.version ?? null, a: version, motivo } ];
	escribirJSON( rutaRegistro( id ), registro );
	git( RAIZ, 'add', rutaRegistro( id ) );
	git( RAIZ, 'commit', '-q', '-m', `Registro: ${ id } vuelve a ${ version }` );
	ok( 'Registro de versiones actualizado (la versión retirada se conserva)' );
	console.log( '\nFalta enviar a GitHub (push) el taller y el escaparate.\n' );

}

// ---------------------------------------------------------------- estado

function estado( id ) {

	comprobarPromocion( id );
	const r = leerRegistro( id );
	if ( ! r.versiones.length ) return console.log( `${ id }: sin versiones publicadas` );
	console.log( `${ id }:` );
	for ( const v of r.versiones ) console.log( `  ${ v.version.padEnd( 4 ) } ${ v.estado.padEnd( 11 ) } ${ v.fecha }  ${ v.aprobadoPor } · ${ v.cambios }` );

}

// ---------------------------------------------------------------- órdenes

const [ orden, id, extra ] = posicionales;
switch ( orden ) {

	case 'construir': construir( id ); break;
	case 'publicar': publicar( id ); break;
	case 'volver': volver( id, extra ); break;
	case 'estado': estado( id ); break;
	case 'indice': actualizarIndice( rutaEscaparate() ); ok( 'publico/promociones.json actualizado (falta commit en el escaparate)' ); break;
	default: fallo( 'Orden desconocida. Usa: construir | publicar | volver | estado | indice' );

}
