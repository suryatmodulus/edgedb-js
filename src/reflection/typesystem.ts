import type {$expr_TypeIntersection, $pathify, $expr_PathNode} from "./path";
import type {$expr_Literal} from "./literal";
import type {typeutil} from "./util/typeutil";
import {Cardinality, ExpressionKind, TypeKind} from "./enums";

//////////////////
// BASETYPE
//////////////////

export interface BaseType {
  __kind__: TypeKind;
  __name__: string;
}
export type BaseTypeSet = {
  __element__: BaseType;
  __cardinality__: Cardinality;
};
export type BaseTypeTuple = typeutil.tupleOf<BaseType>;

//////////////////
// SCALARTYPE
//////////////////

export interface ScalarType<
  Name extends string = string,
  TsType extends any = any,
  TsConstType extends TsType = TsType
> extends BaseType {
  __kind__: TypeKind.scalar;
  __tstype__: TsType;
  __tsconsttype__: TsConstType;
  __name__: Name;
  <T extends TsType = TsType>(val: T): $expr_Literal<
    ScalarType<Name, TsType, T>
  >;
}

////////////////////
// SETS AND EXPRESSIONS
////////////////////

export interface TypeSet<
  T extends BaseType = BaseType,
  Card extends Cardinality = Cardinality
> {
  __element__: T;
  __cardinality__: Card;
}

// utility function for creating set
export function $toSet<Root extends BaseType, Card extends Cardinality>(
  root: Root,
  card: Card
): TypeSet<Root, Card> {
  return {
    __element__: root,
    __cardinality__: card,
  };
}

export type Expression<Set extends TypeSet = TypeSet> =
  BaseType extends Set["__element__"]
    ? Set & {toEdgeQL(): string; $is: any; $assertSingle: any}
    : Set & ExpressionMethods<stripSet<Set>> & $pathify<Set>;

export type stripSet<T> = "__element__" extends keyof T
  ? "__cardinality__" extends keyof T
    ? {
        __element__: T["__element__"];
        __cardinality__: T["__cardinality__"];
      }
    : T
  : T;

export type stripSetShape<T> = {
  [k in keyof T]: stripSet<T[k]>;
};

// importing the actual alias from
// generated/modules/std didn't work.
// returned 'any' every time
export type $assertSingle<
  Type extends BaseType
  // Expr extends TypeSet
> = Expression<{
  __element__: Type;
  __cardinality__: Cardinality.One;
  __kind__: ExpressionKind.Function;
  __name__: "std::assert_single";
  __args__: [TypeSet]; // discard wrapped expression
  __namedargs__: {};
}>;

export interface ExpressionMethods<Set extends TypeSet> {
  __element__: Set["__element__"];
  __cardinality__: Set["__cardinality__"];

  toEdgeQL(): string;
  $is<T extends ObjectTypeSet>(
    ixn: T
  ): $expr_TypeIntersection<
    {__cardinality__: Set["__cardinality__"]; __element__: Set["__element__"]},
    // might cause performance issues
    ObjectType<
      T["__element__"]["__name__"],
      T["__element__"]["__pointers__"],
      {id: true}
    >
  >;
  $assertSingle(): $assertSingle<Set["__element__"]>;
}

//////////////////
// ENUMTYPE
//////////////////

export interface EnumType<
  Name extends string = string,
  TsType extends any = any,
  Vals extends any = any
> extends BaseType {
  __kind__: TypeKind.enum;
  __tstype__: TsType;
  __name__: Name;
  (val: TsType | Vals): $expr_Literal<this>;
}

//////////////////
// OBJECTTYPE
//////////////////

export type ObjectTypeSet = TypeSet<ObjectType, Cardinality>;
export type ObjectTypeExpression = TypeSet<ObjectType, Cardinality>;

export interface ObjectType<
  Name extends string = string,
  Pointers extends ObjectTypePointers = ObjectTypePointers,
  Shape extends object | null = any
  // Polys extends Poly[] = any[]
> extends BaseType {
  __kind__: TypeKind.object;
  __name__: Name;
  __pointers__: Pointers;
  __shape__: Shape;
  // __polys__: Polys;
}

export type PropertyTypes =
  | ScalarType
  | EnumType
  | ArrayType
  | TupleType
  | NamedTupleType;

export interface PropertyDesc<
  Type extends BaseType = BaseType,
  Card extends Cardinality = Cardinality,
  Exclusive extends boolean = boolean,
  Writable extends boolean = boolean
> {
  __kind__: "property";
  target: Type;
  cardinality: Card;
  exclusive: Exclusive;
  writable: Writable;
}

export type $scopify<Type extends ObjectType> = $expr_PathNode<
  TypeSet<Type, Cardinality.One>,
  null,
  true // exclusivity
>;

export type PropertyShape = {
  [k: string]: PropertyDesc;
};

export interface LinkDesc<
  Type extends ObjectType = any,
  Card extends Cardinality = Cardinality,
  LinkProps extends PropertyShape = any,
  Exclusive extends boolean = boolean,
  Writable extends boolean = boolean
> {
  __kind__: "link";
  target: Type;
  cardinality: Card;
  properties: LinkProps;
  exclusive: Exclusive;
  writable: Writable;
}

export type ObjectTypePointers = {
  [k: string]: PropertyDesc | LinkDesc;
};

export type stripBacklinks<T extends ObjectTypePointers> = {
  [k in keyof T]: k extends `<${string}` ? never : T[k];
};

export type omitBacklinks<T extends string | number | symbol> =
  T extends `<${string}` ? never : T extends string ? T : never;

export type stripNonWritables<T extends ObjectTypePointers> = {
  [k in keyof T]: [T[k]["writable"]] extends [true] ? T[k] : never;
};

type shapeElementToTs<Pointer extends PropertyDesc | LinkDesc, Element> = [
  Element
] extends [true]
  ? pointerToTsType<Pointer>
  : [Element] extends [false]
  ? never
  : [Element] extends [boolean]
  ? pointerToTsType<Pointer> | undefined
  : Element extends TypeSet
  ? setToTsType<Element>
  : Pointer extends LinkDesc
  ? Element extends (...scope: any[]) => any
    ? computeObjectShape<
        Pointer["target"]["__pointers__"] & Pointer["properties"],
        ReturnType<Element>
      >
    : Element extends object
    ? computeObjectShape<
        Pointer["target"]["__pointers__"] & Pointer["properties"],
        Element
      >
    : never
  : never;

// Element extends (scope: any) => any
// ? Pointer["target"] extends ObjectType
//   ? computeObjectShape<
//       Pointer["target"]["__pointers__"],
//       ReturnType<Element>
//     >
//   : never
// : Element extends object
// ? Pointer["target"] extends ObjectType
//   ? computeObjectShape<Pointer["target"]["__pointers__"], Element>
//   : never
// : never;

export type $expr_PolyShapeElement<
  PolyType extends ObjectTypeSet = ObjectTypeSet,
  ShapeElement extends any = any
> = {
  __kind__: ExpressionKind.PolyShapeElement;
  __polyType__: PolyType;
  __shapeElement__: ShapeElement;
};

export type computeObjectShape<
  Pointers extends ObjectTypePointers,
  Shape
> = typeutil.flatten<
  keyof Shape extends never
    ? {id: string}
    : {
        [k in keyof Shape]: Shape[k] extends $expr_PolyShapeElement<
          infer PolyType,
          infer ShapeEl
        >
          ? [k] extends [keyof PolyType["__element__"]["__pointers__"]]
            ? shapeElementToTs<
                PolyType["__element__"]["__pointers__"][k],
                ShapeEl
              > | null
            : never
          : [k] extends [keyof Pointers]
          ? shapeElementToTs<Pointers[k], Shape[k]>
          : Shape[k] extends TypeSet
          ? setToTsType<Shape[k]>
          : never;
      }
>;

export type pointerToTsTypeSimple<El extends PropertyDesc | LinkDesc> =
  El extends PropertyDesc
    ? propToTsType<El>
    : El extends LinkDesc<any, any, any, any>
    ? {id: string}
    : never;

export type PrimitiveType =
  | ScalarType
  | EnumType
  | TupleType
  | NamedTupleType
  | ArrayType;

export type PrimitiveTypeSet = TypeSet<PrimitiveType, Cardinality>;

/////////////////////////
/// ARRAYTYPE
/////////////////////////
export interface ArrayType<
  Element extends NonArrayType = NonArrayType,
  Name extends string = `array<${Element["__name__"]}>`
> extends BaseType {
  __name__: Name;
  __kind__: TypeKind.array;
  __element__: Element;
}

export function ArrayType<Element extends NonArrayType>(
  element: Element
): ArrayType<Element> {
  return {
    __kind__: TypeKind.array,
    __name__: `array<${element.__name__}>`,
    __element__: element,
  } as any;
}

type ArrayTypeToTsType<Type extends ArrayType> = Array<
  BaseTypeToTsType<Type["__element__"]>
>;

/////////////////////////
/// TUPLE TYPE
/////////////////////////
export interface TupleType<Items extends BaseTypeTuple = BaseTypeTuple>
  extends BaseType {
  __name__: string;
  __kind__: TypeKind.tuple;
  __items__: Items;
}
export function TupleType<Items extends typeutil.tupleOf<BaseType>>(
  items: Items
): TupleType<Items> {
  const name = `tuple<${items.map(item => item.__name__).join(", ")}>`;
  return {
    __kind__: TypeKind.tuple,
    __name__: name,
    __items__: items,
  } as any;
}

type TupleItemsToTsType<Items extends BaseTypeTuple> = {
  [k in keyof Items]: Items[k] extends BaseType
    ? BaseTypeToTsType<Items[k]>
    : never;
};

/////////////////////////
/// NAMED TUPLE TYPE
/////////////////////////

export type NamedTupleShape = {[k: string]: BaseType};
export interface NamedTupleType<
  Shape extends NamedTupleShape = NamedTupleShape
> extends BaseType {
  __name__: string;
  __kind__: TypeKind.namedtuple;
  __shape__: Shape;
}
export function NamedTupleType<Shape extends NamedTupleShape>(
  shape: Shape
): NamedTupleType<Shape> {
  const name = `tuple<${Object.entries(shape)
    .map(([key, val]) => `${key}: ${val.__name__}`)
    .join(", ")}>`;
  return {
    __kind__: TypeKind.namedtuple,
    __name__: name,
    __shape__: shape,
  } as any;
}

type NamedTupleTypeToTsType<Type extends NamedTupleType> = {
  [k in keyof Type["__shape__"]]: BaseTypeToTsType<Type["__shape__"][k]>;
};

/////////////////////
/// TSTYPE COMPUTATION
/////////////////////

export type BaseTypeToTsType<Type extends BaseType> = Type extends ScalarType
  ? Type["__tsconsttype__"]
  : Type extends EnumType
  ? Type["__tstype__"]
  : Type extends ArrayType
  ? ArrayTypeToTsType<Type>
  : Type extends TupleType
  ? TupleItemsToTsType<Type["__items__"]>
  : Type extends NamedTupleType
  ? NamedTupleTypeToTsType<Type>
  : Type extends ObjectType
  ? computeObjectShape<
      Type["__pointers__"],
      Type["__shape__"]
      // Type["__polys__"]
    >
  : never;

export type setToTsType<Set extends TypeSet> = computeTsType<
  Set["__element__"],
  Set["__cardinality__"]
>;

export type computeTsType<
  T extends BaseType,
  C extends Cardinality
> = Cardinality extends C
  ? unknown
  : BaseType extends T
  ? unknown
  : C extends Cardinality.Empty
  ? null
  : C extends Cardinality.One
  ? BaseTypeToTsType<T>
  : C extends Cardinality.AtLeastOne
  ? [BaseTypeToTsType<T>, ...BaseTypeToTsType<T>[]]
  : C extends Cardinality.AtMostOne
  ? BaseTypeToTsType<T> | null
  : C extends Cardinality.Many
  ? BaseTypeToTsType<T>[]
  : C extends Cardinality
  ? unknown
  : never;

export type propToTsType<Prop extends PropertyDesc> =
  Prop extends PropertyDesc<infer Type, infer Card>
    ? setToTsType<TypeSet<Type, Card>>
    : never;

export type linkToTsType<Link extends LinkDesc> = computeTsType<
  Link["target"],
  Link["cardinality"]
>;

export type pointerToTsType<El extends PropertyDesc | LinkDesc> =
  El extends PropertyDesc
    ? propToTsType<El>
    : El extends LinkDesc<any, any, any, any>
    ? linkToTsType<El>
    : never;

///////////////////
// TYPE HELPERS
///////////////////

export function isScalarType(type: BaseType): type is ScalarType {
  return type.__kind__ === TypeKind.scalar;
}
export function isEnumType(type: BaseType): type is EnumType {
  return type.__kind__ === TypeKind.enum;
}
export function isObjectType(type: BaseType): type is ObjectType {
  return type.__kind__ === TypeKind.object;
}
export function isTupleType(type: BaseType): type is TupleType {
  return type.__kind__ === TypeKind.tuple;
}
export function isNamedTupleType(type: BaseType): type is NamedTupleType {
  return type.__kind__ === TypeKind.namedtuple;
}
export function isArrayType(type: BaseType): type is ArrayType {
  return type.__kind__ === TypeKind.array;
}

export type NonArrayType =
  | ScalarType
  | EnumType
  | ObjectType
  | TupleType
  | NamedTupleType;

export type AnyTupleType = TupleType | NamedTupleType;

export type ParamType = ScalarType | ArrayType<ScalarType>;
