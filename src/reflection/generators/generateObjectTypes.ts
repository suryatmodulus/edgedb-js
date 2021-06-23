import {genutil} from "../genutil";
import {GeneratorParams} from "./generateCastMaps";
import * as introspect from "../queries/getTypes";

export const generateObjectTypes = async (params: GeneratorParams) => {
  const {dir, types, casts} = params;

  for (const type of types.values()) {
    if (type.kind !== "object") {
      continue;
    }
    if (
      (type.union_of && type.union_of.length) ||
      (type.intersection_of && type.intersection_of.length)
    ) {
      continue;
    }

    const {mod, name} = genutil.splitName(type.name);
    const ident = genutil.toIdent(name);
    const body = dir.getPath(`modules/${mod}.ts`);
    body.addImport(`import {reflection as $} from "edgedb";`);
    // body.addImport(`import {spec as __spec__} from "../__spec__";`);
    body.addImport(`import {spec as __spec__} from "../__newspec__";`);

    const scopeName = genutil.getScopedDisplayName(mod, body);

    const getStringRepresentation: (
      type: introspect.Type
    ) => {staticType: string; runtimeType: string} = (type) => {
      if (type.kind === "object") {
        return {
          staticType: scopeName(type.name),
          runtimeType: scopeName(type.name),
        };
      } else if (type.kind === "scalar") {
        return {
          staticType: scopeName(type.name),
          runtimeType: scopeName(type.name),
        };
        // const tsType = genutil.toJsScalarType(target, types, mod, body);
      } else if (type.kind === "array") {
        return {
          staticType: `$.ArrayType<"${type.name}", ${
            getStringRepresentation(types.get(type.array_element_id))
              .staticType
          }>`,
          runtimeType: `$.ArrayType("${type.name}", ${
            getStringRepresentation(types.get(type.array_element_id))
              .runtimeType
          })`,
        };
      } else if (type.kind === "tuple") {
        const isNamed = type.tuple_elements[0].name !== "0";
        if (isNamed) {
          const itemsStatic = type.tuple_elements
            .map(
              (it) =>
                `${it.name}: ${
                  getStringRepresentation(types.get(it.target_id)).staticType
                }`
            )
            .join(", ");
          const itemsRuntime = type.tuple_elements
            .map(
              (it) =>
                `${it.name}: ${
                  getStringRepresentation(types.get(it.target_id)).runtimeType
                }`
            )
            .join(", ");
          return {
            staticType: `$.NamedTupleType<"${type.name}", {${itemsStatic}}>`,
            runtimeType: `$.NamedTupleType("${type.name}", {${itemsRuntime}})`,
          };
        } else {
          const items = type.tuple_elements
            .map((it) => it.target_id)
            .map((id) => types.get(id))
            .map((type) => getStringRepresentation(type));

          return {
            staticType: `$.UnnamedTupleType<"${type.name}",
                [${items.map((it) => it.staticType).join(", ")}]>`,
            runtimeType: `$.UnnamedTupleType("${type.name}",
                [${items.map((it) => it.runtimeType).join(", ")}])`,
          };
        }
      } else {
        throw "Invalid type";
      }
    };

    // get bases
    const bases: string[] = [];
    for (const {id: baseId} of type.bases) {
      const baseName = genutil.getScopedDisplayName(
        mod,
        body
      )(types.get(baseId).name);
      bases.push(baseName);
    }

    /////////
    // generate interface
    /////////

    let lines: {
      card: string;
      staticType: string;
      runtimeType: string;
      key: string;
      kind: "link" | "property";
    }[] = [];

    const allPointers: introspect.Pointer[] = [];
    for (const ancestor of type.ancestors) {
      const ancestorType = types.get(ancestor.id) as introspect.ObjectType;
      allPointers.push(...ancestorType.pointers);
    }
    const seen = new Set<string>();
    allPointers.push(...type.pointers);

    const filteredPointers = allPointers.filter((ptr) => {
      if (seen.has(ptr.name)) return false;
      seen.add(ptr.name);
      return true;
    });
    for (const ptr of filteredPointers) {
      const card = `$.Cardinality.${genutil.toCardinality(ptr)}`;
      const target = types.get(ptr.target_id);
      const {staticType, runtimeType} = getStringRepresentation(target);
      lines.push({
        key: ptr.name,
        staticType,
        runtimeType,
        card,
        kind: ptr.kind,
      });
    }

    // generate shape type
    const baseTypesUnion = bases.length
      ? `${bases.map((b) => `${b}Shape`).join(" & ")} & `
      : ``;
    body.writeln(
      `export type ${ident}Shape = $.typeutil.flatten<${baseTypesUnion}{`
    );
    body.indented(() => {
      for (const line of lines) {
        if (line.kind === "link") {
          body.writeln(
            `${line.key}: $.LinkDesc<${line.staticType}, ${line.card}>;`
          );
        } else {
          body.writeln(
            `${line.key}: $.PropertyDesc<${line.staticType}, ${line.card}>;`
          );
        }
      }
    });
    body.writeln(`}>`);

    // instantiate ObjectType subtype from shape
    body.writeln(
      `export type ${ident} = $.ObjectType<"${type.name}", ${ident}Shape>;`
    );

    //////////////
    // generate runtime type
    //////////////
    // body.writeln(`export const ${ident}: ${ident} = {`);
    // body.indented(() => {
    //   body.writeln(`__name__: "${type.name}",`);
    //   body.writeln(`__shape__: {`);
    //   // for (const base of bases) {
    //   //   body.indented(() => {
    //   //     body.writeln(`...${base}.__shape__,`);
    //   //   });
    //   // }
    //   for (const line of lines) {
    //     body.indented(() => {
    //       if (line.kind === "property") {
    //         body.writeln(
    //           `${line.key}: { get propertyTarget(){ return ${line.runtimeType} }, cardinality: ${line.card} },`
    //         );
    //       } else {
    //         body.writeln(
    //           `${line.key}: { get linkTarget(){ return ${line.runtimeType} }, cardinality: ${line.card} },`
    //         );
    //       }
    //     });
    //   }
    //   body.writeln(`}`);
    // });
    // body.writeln(`} as any;`);

    body.nl();
    /////////
    // generate path expression
    /////////

    body.writeln(`export const ${ident} = $.makeType<${ident}>(`);
    body.indented(() => {
      body.writeln(`__spec__,`);
      body.writeln(`${JSON.stringify(type.id)},`);
    });
    body.writeln(`);`);
    body.nl();
    body.nl();
  }
};