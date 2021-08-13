import * as introspect from "./queries/getTypes";

import {
  BaseType,
  TypeKind,
  ObjectType,
  ObjectTypeShape,
  shapeToTsType,
  MaterialType,
} from "./typesystem";

import {typeutil, util} from "./util/util";

const typeCache = new Map<string, BaseType>();

function applySpec(
  spec: introspect.Types,
  type: introspect.ObjectType,
  shape: any,
  seen: Set<string>,
  literal: any
): void {
  const allPointers = [
    ...type.pointers,
    ...type.backlinks,
    ...type.backlink_stubs,
  ];
  for (const ptr of allPointers) {
    if (seen.has(ptr.name)) {
      continue;
    }
    seen.add(ptr.name);

    if (ptr.kind === "link") {
      util.defineGetter(shape, ptr.name, () => {
        return {
          __kind__: "link",
          cardinality: ptr.real_cardinality,
          get target() {
            return makeType(spec, ptr.target_id, literal);
          },
          get properties() {
            const linkProperties: {[k: string]: any} = {};
            (ptr.pointers || []).forEach((linkProp) => {
              // We only support "link properties" in EdgeDB, currently.
              if (linkProp.kind !== "property") {
                return;
              }
              // No use for them reflected, at the moment.
              if (linkProp.name === "source" || linkProp.name === "target") {
                return;
              }

              const linkPropObject: any = {
                __kind__: "property",
              };
              linkPropObject.cardinality = linkProp.real_cardinality;
              util.defineGetter(linkPropObject, "target", () => {
                return makeType(spec, linkProp.target_id, literal);
              });
              linkProperties[linkProp.name] = linkPropObject;
            });
            return linkProperties;
          },
          exclusive: ptr.is_exclusive,
        };
      });
    } else if (ptr.kind === "property") {
      util.defineGetter(shape, ptr.name, () => {
        return {
          __kind__: "property",
          cardinality: ptr.real_cardinality,
          get target() {
            return makeType(spec, ptr.target_id, literal);
          },
          exclusive: ptr.is_exclusive,
        };
      });
    }
  }
}

export function makeType<T extends BaseType>(
  spec: introspect.Types,
  id: string,
  literal: (type: any, val: any) => any,
  anytype?: MaterialType
): T {
  const type = spec.get(id);

  if (typeCache.has(type.name)) {
    return typeCache.get(type.name) as T;
  }

  const obj: any = {};
  obj.__name__ = type.name;

  if (type.name === "anytype") {
    if (anytype) return anytype as unknown as T;
    throw new Error("anytype not provided");
  }

  if (type.kind === "object") {
    obj.__kind__ = TypeKind.object;
    util.defineGetter(obj, "__shape__", () => {
      const shape: any = {};
      const seen = new Set<string>();
      applySpec(spec, type, shape, seen, literal);
      const ancestors = [...type.bases];
      for (const anc of ancestors) {
        const ancType = spec.get(anc.id);
        if (ancType.kind === "object" || ancType.kind === "scalar") {
          ancestors.push(...ancType.bases);
        }
        if (ancType.kind !== "object") {
          throw new Error(`Not an object: ${id}`);
        }
        applySpec(spec, ancType, shape, seen, literal);
      }
      return shape as any;
    });
    obj.__params__ = {};
    obj.__polys__ = [];
    return obj;
  } else if (type.kind === "scalar") {
    const scalarObj = ((val: any) => {
      return literal(scalarObj, val);
    }) as any;
    scalarObj.__kind__ = type.enum_values ? TypeKind.enum : TypeKind.scalar;
    scalarObj.__name__ = type.name;
    if (type.enum_values) {
      for (const val of type.enum_values) {
        scalarObj[val] = val;
      }
    }
    typeCache.set(type.name, scalarObj);
    return scalarObj;
  } else if (type.kind === "array") {
    obj.__kind__ = TypeKind.array;
    util.defineGetter(obj, "__element__", () => {
      return makeType(spec, type.array_element_id, literal, anytype);
    });
    util.defineGetter(obj, "__name__", () => {
      return `array<${obj.__element__.__name__}>`;
    });
    return obj;
  } else if (type.kind === "tuple") {
    if (type.tuple_elements[0].name === "0") {
      // unnamed tuple
      obj.__kind__ = TypeKind.tuple;

      util.defineGetter(obj, "__items__", () => {
        return type.tuple_elements.map((el) =>
          makeType(spec, el.target_id, literal, anytype)
        ) as any;
      });
      util.defineGetter(obj, "__name__", () => {
        return `tuple<${obj.__items__
          .map((item: any) => item.__name__)
          .join(", ")}>`;
      });
      return obj;
    } else {
      // named tuple
      obj.__kind__ = TypeKind.namedtuple;

      util.defineGetter(obj, "__shape__", () => {
        const shape: any = {};
        for (const el of type.tuple_elements) {
          shape[el.name] = makeType(spec, el.target_id, literal, anytype);
        }
        return shape;
      });
      util.defineGetter(obj, "__name__", () => {
        return `tuple<${Object.entries(obj.__shape__)
          .map(([key, val]: [string, any]) => `${key}: ${val.__name__}`)
          .join(", ")}>`;
      });
      return obj;
    }
  } else {
    throw new Error("Invalid type.");
  }
}
export type mergeObjectShapes<
  A extends ObjectTypeShape,
  B extends ObjectTypeShape
> = typeutil.flatten<
  {
    [k in keyof A & keyof B]: A[k] extends B[k] // possible performance issue?
      ? B[k] extends A[k]
        ? A[k]
        : never
      : never;
  }
>;

export type mergeObjectTypes<
  A extends ObjectType | undefined,
  B extends ObjectType | undefined
> = A extends ObjectType
  ? B extends ObjectType
    ? ObjectType<
        `${A["__name__"]} UNION ${B["__name__"]}`,
        mergeObjectShapes<A["__shape__"], B["__shape__"]>,
        null,
        []
      >
    : A
  : B extends ObjectType
  ? B
  : undefined;

export function mergeObjectTypes<A extends ObjectType, B extends ObjectType>(
  a: A,
  b: B
): mergeObjectTypes<A, B> {
  const obj: ObjectType = {
    __kind__: TypeKind.object,
    __name__: `${a.__name__} UNION ${b.__name__}`,
    get __shape__() {
      const merged: any = {};
      for (const [akey, aitem] of Object.entries(a.__shape__)) {
        if (!b.__shape__[akey]) continue;

        const bitem = b.__shape__[akey];
        if (aitem.cardinality !== bitem.cardinality) continue;
        // names must reflect full type
        if (aitem.target.__name__ !== bitem.target.__name__) continue;
        merged[akey] = aitem;
      }
      return merged;
    },
    __params__: {},
    __polys__: [],
    __tstype__: undefined as any,
  };
  return obj as any;
}