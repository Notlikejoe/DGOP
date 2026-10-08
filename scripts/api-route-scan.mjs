import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json',import.meta.url));
const ts = require('typescript');

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
