// Formato de datos de una vivienda. Todo en metros, en planta:
// x hacia el este, y hacia el norte. Cada dato lleva su `origen`
// (plano | usuario | memoria | supuesto) para saber qué es fiable.

export type Rect = [ number, number, number, number ]; // xmin, ymin, xmax, ymax
export type Punto = [ number, number ];
export type Orientacion = 'n' | 's' | 'e' | 'o';

export interface Valor<T> {
	valor: T;
	origen: string;
}

export interface Muro {
	id: string;
	tipo: 'envolvente' | 'tabique' | 'pilar';
	rect: Rect;
	origen: string;
}

export interface Hueco {
	id: string;
	muro: string;
	tipo: 'entrada' | 'puerta' | 'balconera';
	eje: 'x' | 'y';
	desde: number;
	hasta: number;
	bisagra?: 'inicio' | 'fin';
	abre?: Orientacion;
	apertura?: 'corredera' | 'oscilobatiente';
	hojas?: number;
	origen: string;
}

export type Uso = 'dia' | 'noche' | 'humedo' | 'servicio' | 'circulacion' | 'exterior';

export interface Estancia {
	id: string;
	nombre: string;
	superficie: number;
	uso: Uso;
	suelo: string;
	poligono: Punto[];
	origen: string;
}

export interface Equipamiento {
	id: string;
	tipo: string;
	rect: Rect;
	frente: Orientacion;
	fijo: boolean;
	origen: string;
	placa?: [ number, number ];
	fregadero?: [ number, number ];
	lavavajillas?: [ number, number ];
}

export interface Vivienda {
	meta: {
		nombre: string;
		fuente: string;
		superficies_oficiales: { interior: number; exterior: number; construida: number };
	};
	alturas: {
		libre: Valor<number>;
		forjado: Valor<number>;
		puerta_interior: Valor<number>;
		puerta_entrada: Valor<number>;
		balconera: Valor<number>;
		barandilla: Valor<number>;
	};
	muros: Muro[];
	huecos: Hueco[];
	estancias: Estancia[];
	equipamiento: Equipamiento[];
	exterior: {
		barandilla: { recorrido: Punto[]; postes_x: number[] };
	};
}
