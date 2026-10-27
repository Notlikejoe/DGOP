import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json',import.meta.url));
const ts = require('typescript');

/** Inspect only the error callback body, never a neighboring validation branch. */
export function genericToastErrorCallbacks(file,text) {
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),lines=[];
  function visit(node){
    if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='error'&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer))){
      let generic=false;
      function inspect(child){if(ts.isCallExpression(child)&&ts.isPropertyAccessExpression(child.expression)&&child.expression.name.text==='error'&&ts.isPropertyAccessExpression(child.expression.expression)&&child.expression.expression.name.text==='toast')generic=true;ts.forEachChild(child,inspect);}
      inspect(node.initializer.body);if(generic)lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line+1);
    }
    ts.forEachChild(node,visit);
  }
  visit(source);return lines;
}

/** Enforced shared role-query contract, independent of whitespace and quote style. */
export function liveRoleQueryContract(file,text,methodName,helperText) {
  const parse=(name,value)=>ts.createSourceFile(name,value,ts.ScriptTarget.Latest,true);
  const property=(object,key)=>object&&ts.isObjectLiteralExpression(object)?object.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.text===key)?.initializer:undefined;
  const nil=node=>node?.kind===ts.SyntaxKind.NullKeyword,truth=node=>node?.kind===ts.SyntaxKind.TrueKeyword;
  const helper=parse('business-roles.ts',helperText),source=parse(file,text);
  let definition,method,imported=false;
  for(const statement of helper.statements)if(ts.isFunctionDeclaration(statement)&&statement.name?.text==='liveRoleWhere')definition=statement;
  const returned=definition?.body?.statements.find(ts.isReturnStatement)?.expression;
  const alternatives=property(returned,'OR');
  if(!truth(property(returned,'isActive'))||!nil(property(returned,'deletedAt'))||!alternatives||!ts.isArrayLiteralExpression(alternatives)||alternatives.elements.length!==2)return false;
  const canonical=property(property(alternatives.elements[1],'businessRole'),'is');
  if(!nil(property(alternatives.elements[0],'businessRoleCode'))||!truth(property(canonical,'isActive'))||!nil(property(canonical,'deletedAt'))||!nil(property(canonical,'businessRoleCode')))return false;
  for(const statement of source.statements){
    if(ts.isImportDeclaration(statement)&&statement.moduleSpecifier.text==='../auth/business-roles'&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings))imported=statement.importClause.namedBindings.elements.some(element=>element.name.text==='liveRoleWhere'&&!element.propertyName);
    if(ts.isClassDeclaration(statement))method=statement.members.find(member=>ts.isMethodDeclaration(member)&&member.name.getText(source)===methodName)??method;
  }
  if(!imported||!method?.body)return false;
  let valid=false;
  function visit(node){
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='findMany'&&ts.isPropertyAccessExpression(node.expression.expression)&&node.expression.expression.name.text==='role'){
      const and=property(property(node.arguments[0],'where'),'AND');
      if(and&&ts.isArrayLiteralExpression(and))valid=and.elements.some(e=>ts.isCallExpression(e)&&ts.isIdentifier(e.expression)&&e.expression.text==='liveRoleWhere'&&e.arguments.length===0)&&and.elements.some(e=>{const input=property(property(e,'code'),'in');return input&&ts.isIdentifier(input)&&input.text==='roleCodes';});
    }
    ts.forEachChild(node,visit);
  }
  visit(method.body);return valid;
}

/** Reads actual controller syntax, including inline and multiline decorators. */
export function controllerRoutes(file,text) {
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const decorators=node=>(ts.canHaveDecorators(node)?ts.getDecorators(node)??[]:[]).map(decorator=>{
    const expression=decorator.expression;
    const name=ts.isCallExpression(expression)?expression.expression.getText(source):expression.getText(source);
    return {line:source.getLineAndCharacterOfPosition(decorator.getStart(source)).line+1,name,text:decorator.getText(source)};
  });
  const blocks=[];
  function visit(node){
    if(ts.isClassDeclaration(node))for(const member of node.members)if(ts.isMethodDeclaration(member))blocks.push({
      file,methodLine:source.getLineAndCharacterOfPosition(member.name.getStart(source)).line+1,method:member.name.getText(source),controllerDecorators:decorators(node),decorators:decorators(member),
    });
    ts.forEachChild(node,visit);
  }
  visit(source);return blocks;
}
