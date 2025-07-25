// see https://github.com/babel/babel/pull/6015

const syntaxBigInt = require('@babel/plugin-syntax-bigint').default;

module.exports = function (babel) {
  const types = babel.types;
  const getFunctionName = function (operator) {
    switch (operator) {
      // Arithmetic operators
      case '+': return 'add';
      case '-': return 'subtract';
      case '*': return 'multiply';
      case '/': return 'divide';
      case '%': return 'remainder';
      case '**': return 'exponentiate';
      // Bitwise shift operators
      case '<<': return 'leftShift';
      case '>>': return 'signedRightShift';
      // Binary bitwise operators
      case '&': return 'bitwiseAnd';
      case '|': return 'bitwiseOr';
      case '^': return 'bitwiseXor';
    }
    return null;
  };
  const getRelationalFunctionName = function (operator) {
    // Relational operators
    switch (operator) {
      case '<': return 'lessThan';
      case '>': return 'greaterThan';
      case '<=': return 'lessThanOrEqual';
      case '>=': return 'greaterThanOrEqual';
      case '===': return 'equal';
      case '!==': return 'notEqual';
    }
    return null;
  };
  const getUnaryFunctionName = function (operator) {
    switch (operator) {
      case '-': return 'unaryMinus';
      case '~': return 'bitwiseNot';
    }
    return null;
  };
  const getUpdateFunctionName = function (operator) {
    switch (operator) {
      case '++': return 'add';
      case '--': return 'subtract';
    }
    return null;
  };

  let visited = new Map();
  const canBeBigInt = function (path) {
    if (visited.get(path) != null) {
      return visited.get(path);
    }
    visited.set(path, maybeJSBI);
    const result = canBeBigIntInternal(path);
    //console.debug('canBeBigInt: ' + path.toString() + ', result: ' + result);
    if (result === maybeJSBI) {
      visited.delete(path);
    } else {
      visited.set(path, result);
    }
    return result;
  };
  const and = function (a, b) {
    if (a === maybeJSBI) {
      return b;
    }
    if (b === maybeJSBI) {
      return a;
    }
    if (a === JSBI && b === JSBI) {
      return JSBI;
    }
    return false;
  };
  
  const tryType = function (X, binding, path) {
    if ((X === false || X === JSBI) && binding.constant) {
      return true;
    }
    if ((X === false || X === JSBI) && !binding.constant) {
      let allAssignmentsHaveSameType = true;
      for (const path of binding.constantViolations) {
        allAssignmentsHaveSameType = allAssignmentsHaveSameType && canBeBigInt(path) === X;
      }
      if (allAssignmentsHaveSameType) {
        return true;
      }
      if (visited.get(path) === maybeJSBI) { // assume that variable type is the same
        const visitedOriginal = new Map(visited.entries());
        visited.set(path, X);
        for (const e of visited.entries()) {
          if (e[1] === maybeJSBI) {
            visited.delete(e[0]);
          }
        }
        let allAssignmentsHaveSameType = true;
        for (const path of binding.constantViolations) {
          allAssignmentsHaveSameType = allAssignmentsHaveSameType && canBeBigInt(path) === X;
        }
        if (allAssignmentsHaveSameType) {
          return true;
        }
        visited = visitedOriginal;
      }
    }
    return false;
  };

  const canBeBigIntInternal = function (path) {
    if (path.node.type === 'BigIntLiteral') {
      return JSBI;
    }
    if (path.node.type === 'NumericLiteral') {
      return false;
    }
    if (path.node.type === 'StringLiteral') {
      return false;
    }
    if (path.node.type === 'NullLiteral') {
      return false;
    }
    if (path.node.type === 'RegExpLiteral') {
      return false;
    }
    if (path.node.type === 'BooleanLiteral') {
      return false;
    }
    if (path.node.type === 'TemplateLiteral') {
      return false;
    }
    // Math.floor(a / b)
    if (path.parentPath.node.type === 'CallExpression' &&
        path.parentPath.node.arguments.length === 1 &&
        path.parentPath.node.arguments[0] === path.node) {
      const callee = path.parentPath.node.callee;
      if (callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Math') {
        return false;
      }
    }
    if (path.node.type === 'UnaryExpression') {
      if (path.node.operator === '+') { // +0n is not allowed
        return false;
      }
      return canBeBigInt(path.get('argument'));
    }
    if (path.node.type === 'BinaryExpression') {
      if (getRelationalFunctionName(path.node.operator) != null) {
        return false;
      }
      return and(canBeBigInt(path.get('left')), canBeBigInt(path.get('right')));
    }
    if (path.node.type === 'AssignmentExpression') {
      if (path.node.left.type === 'ArrayPattern') {
        return maybeJSBI;
      }
      if (path.node.operator === '=') {
        return canBeBigInt(path.get('right'));
      }
      return and(canBeBigInt(path.get('left')), canBeBigInt(path.get('right')));
    }

    if (path.node.type === 'Identifier') {
      const binding = path.scope.getBinding(path.node.name);
      if (binding != null) {
        if (binding.path.node.type === 'VariableDeclarator') {
          const x = binding.path.get('init');
          if (x.node != null) {
            let X = null;
            if (x.node.type !== 'ArrayExpression') {
              X = canBeBigInt(x);
              if (tryType(X, binding, path)) {
                return X;
              }
            }
          }
        }
        for (const path of binding.referencePaths) {
          //The next code causes infinite recursion, seems:
          //if (path.parentPath.node.type === 'BinaryExpression' && getFunctionName(path.parentPath.node.operator) != null && canBeBigInt(path.parentPath) === false) {
          //  return false;
          //}
        }
        if (binding.path.node.type === 'Identifier' && binding.path.parentPath.node.type === 'FunctionDeclaration') {
          //console.log(binding.path.parentPath.node, '!!!');
          const functionPath = binding.path.parentPath;
          const id = functionPath.get('id');
          const functionBinding = functionPath.scope.getBinding(id.node.name);
          if (functionBinding != null) {
            let argIsBigInt = undefined;
            //TODO: check no exports
            for (const path of functionBinding.referencePaths) {
              //console.log('function call: ' + path.parentPath + '', path.parentPath);
              const functionCall = path.parentPath;
              if (types.isCallExpression(functionCall)) {
                //TODO: check arguments
                const args = functionCall.get('arguments');
                for (let i = 0; i < args.length; i += 1) {
                  const a = args[i];
                  //console.log('arg', a);
                  const t = canBeBigInt(a);
                  if (t === false && (argIsBigInt == undefined || argIsBigInt === 'false')) {
                    argIsBigInt = 'false';
                  } else if (t === JSBI && (argIsBigInt == undefined || argIsBigInt === 'true')) {
                    argIsBigInt = 'true';
                  } else {
                    argIsBigInt = 'NO';
                  }
                }
              } else {
                argIsBigInt = 'NO';
              }
            }
            if (argIsBigInt === 'false') {
              return false;
            }
            if (argIsBigInt === 'true') {
              return JSBI;
            }
          }
        }
      } else {
        if (path.node.name === 'undefined') {
          return false;
        }
      }
      const checkTypeOf = function (node, variableName, type, not) {
        // typeof x === "bigint"
        if (node.type === 'BinaryExpression' && (!not ? node.operator === '===' : node.operator === '!==')) {
          if (node.left.type === 'UnaryExpression' && node.left.operator === 'typeof') {
            if (node.left.argument.type === 'Identifier' && node.left.argument.name === variableName) {
              if (node.right.type === 'StringLiteral' && node.right.value === type) {
                return true;
              }
            }
          }
        }
        if (type === 'bigint') {
          // x instanceof JSBI
          if (!not || node.type === 'UnaryExpression' && node.operator === '!') {
            if (node.argument.type === 'BinaryExpression' && node.argument.operator === 'instanceof') {
              if (node.argument.left.type === 'Identifier' && node.argument.left.name === variableName) {
                if (node.argument.right.type === 'Identifier' && node.argument.right.name === 'JSBI') {
                  return true;
                }
              }
            }
          }
        }
        return false;
      };
      if (binding != null && binding.constant) {
        const ifStatement = path.findParent(path => path.isIfStatement());
        const variableName = path.node.name;
        if (ifStatement != null) {
          const tmp = ifStatement.get('test');
          if (tmp.node.operator === '&&') {
            if (checkTypeOf(tmp.node.left, variableName, 'number', false)) {
              return false;
            }
            if (checkTypeOf(tmp.node.right, variableName, 'number', false)) {
              return false;
            }
          }
        }
      }
      if (binding != null) {
        //console.debug(binding);
        const functionDeclarationOrExpression = path.findParent(path => path.isFunctionDeclaration() || path.isFunctionExpression());
        if (functionDeclarationOrExpression != null && functionDeclarationOrExpression.node.params.filter(param => !types.isIdentifier(param)).length == 0) {
          const body = functionDeclarationOrExpression.get('body');
          const x = body.get('body')[0];
          if (types.isIfStatement(x)) {
            const ifStatement = x;
            const tmp = ifStatement.get('test');
            const variableName = path.node.name;
            const consequent = ifStatement.get('consequent').node;
            let ok = false;
            if (types.isBlockStatement(consequent)) {
              if (consequent.body.length === 1) {
                if (types.isThrowStatement(consequent.body[0])) {
                  ok = true;
                }
              }
            }
            const isNotTypeOfCheck = function (node, type, variableName) {
              if (checkTypeOf(node, variableName, type, true)) {
                return true;
              }
              if (node.type === 'LogicalExpression' && node.operator === '||') {
                if (isNotTypeOfCheck(node.left, type, variableName)) {
                  return true;
                }
                if (isNotTypeOfCheck(node.right, type, variableName)) {
                  return true;
                }
              }
              return false;
            };
            if (ok && isNotTypeOfCheck(tmp.node, 'bigint', variableName)) {
              if (tryType(JSBI, binding, path)) {
                return JSBI;
              }
            }
            if (ok && isNotTypeOfCheck(tmp.node, 'number', variableName)) {
              if (tryType(false, binding, path)) {
                return false;
              }
            }
          }
        }
      }
      if (binding != null && !binding.constant) {
        let hasFalse = false;
        let hasJSBI= false;
        for (const path of binding.constantViolations) {
          if (canBeBigInt(path) === false) {
            hasFalse = true;
          } else if (canBeBigInt(path) === JSBI) {
            hasJSBI = true;
          }
        }
        if (hasFalse && !hasJSBI) {
          if (tryType(false, binding, path)) {
            return false;
          }
        }
        if (!hasFalse && hasJSBI) {
          if (tryType(JSBI, binding, path)) {
            return JSBI;
          }
        }
      }
      return maybeJSBI;
    }

    if (path.node.type === 'ConditionalExpression') {
      const a = canBeBigInt(path.get('consequent'));
      const b = canBeBigInt(path.get('alternate'));
      return a === b ? a : maybeJSBI;
    }
    if (path.node.type === 'FunctionExpression') {
      return false;
    }
    if (path.node.type === 'NewExpression') {
      return false;
    }
    if (path.node.type === 'LogicalExpression') {
      return false;//?
    }
    if (path.node.type === 'ObjectProperty') {
      return false;//?
    }
    if (path.node.type === 'CallExpression') {
      if (path.node.callee.type === 'MemberExpression' &&
          path.node.callee.object.type === 'Identifier' &&
          path.node.callee.object.name === 'Math') {
        return false;
      }
      if (path.node.callee.type === 'Identifier') {
        const name = path.node.callee.name;
        if (name === 'Number') {
          return false;
        }
        if (name === 'String') {
          return false;
        }
        if (name === 'Boolean') {
          return false;
        }
        if (name === 'BigInt') {
          return JSBI;
        }
      }
      if (path.node.callee.type === 'MemberExpression' &&
          path.node.callee.object.type === 'Identifier' &&
          (path.node.callee.object.name === 'JSBI' || path.node.callee.object.name === 'BigInt')) {
        if (path.node.callee.object.name === 'JSBI') {
          if (['lessThan', 'greateThan', 'equal', 'notEqual', 'lessThanOrEqual', 'greaterThanOrEqual', 'toNumber'].indexOf(path.node.callee.property.name) !== -1) {
            return false;
          }
        }
        return JSBI;
      }
    }
    if (path.node.type === 'CallExpression') {
      if (path.node.callee.type === 'Identifier') {
        const binding = path.scope.getBinding(path.node.callee.name);
        if (binding != null) {
          if (binding.path.node.type === 'FunctionDeclaration' || binding.path.node.type === 'FunctionExpression') {
            //console.log('binding.path', binding.path);
            //const statements = binding.path.get('body').get('body');
            const statements = [];
            binding.path.getScope().traverse(binding.path.node, {ReturnStatement: function(path){ statements.push(path); }}, this);
            let returnType = undefined;
            for (const statement of statements) {
              if (statement.type === 'ReturnStatement') {
                const t = canBeBigInt(statement.get('argument'));
                if (returnType === undefined) {
                  returnType = t;
                }
                if (returnType !== t) {
                  returnType = maybeJSBI;
                }
              }
            }
            if (returnType === false || returnType == JSBI) {
              return returnType;
            }
          }
        }
      }
    }
    if (path.node.type === 'CallExpression') {
      return maybeJSBI;
    }
    if (path.node.type === 'UpdateExpression') {
      return canBeBigInt(path.get('argument'));
    }
    if (path.node.type === 'MemberExpression') {
      return maybeJSBI;
    }
    if (path.node.type === 'ObjectExpression') {
      return false;
    }
    if (path.node.type === 'ArrayExpression') {
      return false;
    }
    if (path.node.type === 'ArrayPattern') {
      return maybeJSBI;
    }
    console.warn('unknown path.node.type: ' + path.node.type);
    //TODO:
    return maybeJSBI;
  };

  const JSBI = 'JSBI';
  const maybeJSBI = 'maybeJSBI';
  //const maybeJSBI = JSBI;
  const IMPORT_PATH = 'jsbi';

  const maybeJSBICode = `

var maybeJSBI = {
  toNumber: function toNumber(a) {
    return typeof a === "object" ? JSBI.toNumber(a) : Number(a);
  },
  add: function add(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.add(a, b) : a + b;
  },
  subtract: function subtract(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.subtract(a, b) : a - b;
  },
  multiply: function multiply(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.multiply(a, b) : a * b;
  },
  divide: function divide(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.divide(a, b) : a / b;
  },
  remainder: function remainder(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.remainder(a, b) : a % b;
  },
  exponentiate: function exponentiate(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.exponentiate(a, b) : (typeof a === "bigint" && typeof b === "bigint" ? new Function("a", "b", "return a**b")(a, b) : Math.pow(a, b));
  },
  leftShift: function leftShift(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.leftShift(a, b) : a << b;
  },
  signedRightShift: function signedRightShift(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.signedRightShift(a, b) : a >> b;
  },
  bitwiseAnd: function bitwiseAnd(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.bitwiseAnd(a, b) : a & b;
  },
  bitwiseOr: function bitwiseOr(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.bitwiseOr(a, b) : a | b;
  },
  bitwiseXor: function bitwiseXor(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.bitwiseXor(a, b) : a ^ b;
  },
  lessThan: function lessThan(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.lessThan(a, b) : a < b;
  },
  greaterThan: function greaterThan(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.greaterThan(a, b) : a > b;
  },
  lessThanOrEqual: function lessThanOrEqual(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.lessThanOrEqual(a, b) : a <= b;
  },
  greaterThanOrEqual: function greaterThanOrEqual(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.greaterThanOrEqual(a, b) : a >= b;
  },
  equal: function equal(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.equal(a, b) : a === b;
  },
  notEqual: function notEqual(a, b) {
    return typeof a === "object" && typeof b === "object" ? JSBI.notEqual(a, b) : a !== b;
  },
  unaryMinus: function unaryMinus(a) {
    return typeof a === "object" ? JSBI.unaryMinus(a) : -a;
  },
  bitwiseNot: function bitwiseNot(a) {
    return typeof a === "object" ? JSBI.bitwiseNot(a) : ~a;
  }
};
  `;
  //const maybeJSBICode = '';
  
  const typeOfIgnore = new Set();

  return {
    inherits: syntaxBigInt,
    visitor: {
      CallExpression: function (path, state) {
        if (path.node.callee.name === 'Number') {
          const JSBI = canBeBigInt(path.get('arguments')[0]);
          if (JSBI !== false) {
            path.replaceWith(types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier('toNumber')), path.node.arguments));
          }
        }
        if (path.node.callee.name === 'BigInt') {
          path.replaceWith(types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier('BigInt')), path.node.arguments));
        }
        if (path.node.callee.type === 'MemberExpression' &&
            path.node.callee.object.type === 'Identifier' &&
            path.node.callee.object.name === 'BigInt' &&
            (path.node.callee.property.name === 'asUintN' || path.node.callee.property.name === 'asIntN')) {
          path.replaceWith(types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier(path.node.callee.property.name)), path.node.arguments));
        }
      },
      BigIntLiteral: function (path, state) {
        const value = path.node.value;
        const number = Number(value); //TODO:
        if (number >= Number.MIN_SAFE_INTEGER && number <= Number.MAX_SAFE_INTEGER) {
          // 1n -> JSBI.BigInt(1)
          path.replaceWith(types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier('BigInt')), [types.numericLiteral(number)]));
        } else {
          // 9007199254740993n -> JSBI.BigInt('9007199254740993')
          path.replaceWith(types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier('BigInt')), [types.StringLiteral(value)]));
        }
      },
      BinaryExpression: function (path, state) {
        const operator = path.node.operator;
        const JSBI = getRelationalFunctionName(operator) != null ? and(canBeBigInt(path.get('left')), canBeBigInt(path.get('right'))) : canBeBigInt(path);
        if (JSBI !== false) {
          const functionName = getFunctionName(operator) || getRelationalFunctionName(operator);
          if (functionName != null) {
            // x * y -> JSBI.multiply(x, y)
            path.replaceWith(types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier(functionName)), [path.node.left, path.node.right]));
          }
        }
        // typeof x
        if ((operator === '===' || operator === '!==') &&
              types.isUnaryExpression(path.node.left) && path.node.left.operator === 'typeof' && types.isIdentifier(path.node.left.argument) &&
              types.isStringLiteral(path.node.right)) {
          // typeof x === 'bigint' -> x instanceof JSBI
          const typeOfTest = path.node.left;
          typeOfIgnore.add(typeOfTest);
          if (path.node.right.value === 'bigint') {
            const instanceOfNode = types.binaryExpression('instanceof', path.node.left.argument, types.identifier('JSBI'));
            path.replaceWith(operator === '!==' ? types.unaryExpression('!', instanceOfNode) : instanceOfNode);
          }
        }
      },
      UnaryExpression: function (path, state) {
        const JSBI = canBeBigInt(path);
        if (JSBI !== false) {
          const functionName = getUnaryFunctionName(path.node.operator);
          if (functionName !== null) {
            // -x -> JSBI.unaryMinus(x)
            path.replaceWith(types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier(functionName)), [path.node.argument]));
          }
        }
        // typeof x
        if (path.node.operator === 'typeof' && !typeOfIgnore.has(path.node)) {
          throw new RangeError('not supported');
        }
      },  
      UpdateExpression: function (path, state) {
        throw new RangeError('UpdateExpressions are not supported because of the complexity: ' + path);
        // The implementation below is buggy, as it converts ++x to x += 1n even for number x
        /*
        const JSBI = canBeBigInt(path);
        if (JSBI !== false) {
          const operator = path.node.operator;
          const prefix = path.node.prefix;
          const functionName = getUpdateFunctionName(operator);
          if (functionName != null) {
            const one = types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier('BigInt')), [types.numericLiteral(1)]);
            const argument = path.node.argument;
            if (types.isMemberExpression(argument)) {
              if (prefix) {
                const x = path.scope.generateUidIdentifier('x');
                path.scope.push({id: x});
                const y = path.scope.generateUidIdentifier('y');
                path.scope.push({id: y});
                // ++object[property] -> (x = object, y = property, x[y] = x[y] + 1)
                path.replaceWith(types.sequenceExpression([
                  types.assignmentExpression('=', x, argument.object),
                  types.assignmentExpression('=', y, argument.computed ? argument.property : types.StringLiteral(argument.property.name)),
                  types.assignmentExpression('=', types.memberExpression(x, y, true), types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier(functionName)), [types.memberExpression(x, y, true), one]))
                ]));
              } else {
                const x = path.scope.generateUidIdentifier('x');
                path.scope.push({id: x});
                const y = path.scope.generateUidIdentifier('y');
                path.scope.push({id: y});
                const z = path.scope.generateUidIdentifier('z');
                path.scope.push({id: z});
                // object[property]++ -> (x = object, y = property, z = x[y], x[y] = x[y] + 1, z)
                path.replaceWith(types.sequenceExpression([
                  types.assignmentExpression('=', x, argument.object),
                  types.assignmentExpression('=', y, argument.computed ? argument.property : types.StringLiteral(argument.property.name)),
                  types.assignmentExpression('=', z, types.memberExpression(x, y, true)),
                  types.assignmentExpression('=', types.memberExpression(x, y, true), types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier(functionName)), [z, one])),
                  z
                ]));
              }
            } else {
              if (prefix) {
                // ++argument -> (argument = argument + 1)
                path.replaceWith(types.assignmentExpression('=', argument, types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier(functionName)), [argument, one])));
              } else {
                const x = path.scope.generateUidIdentifier('x');
                path.scope.push({id: x});
                // argument++ -> (x = argument, argument = argument + 1, x)
                path.replaceWith(types.sequenceExpression([
                  types.assignmentExpression('=', x, argument),
                  types.assignmentExpression('=', argument, types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier(functionName)), [argument, one])),
                  x
                ]));
              }
            }
          }
        }*/
        
      },
      AssignmentExpression: function (path, state) {
        const isConstant = function (path) {
          if (types.isStringLiteral(path.node)) {
            return true;
          }
          if (types.isNumericLiteral(path.node)) {
            return true;
          }
          if (types.isIdentifier(path.node)) {
            const binding = path.scope.getBinding(path.node.name);
            if (binding == null) {
              console.warn('unknown identifier: ' + path.node.name);
              return false;
            }
            return binding.constant;
          }
          return false;
        };
        if (types.isMemberExpression(path.node.left) && types.isIdentifier(path.node.left.object) && path.node.left.object.name === 'arguments') {
          throw new RangeError('arguments should not be used');
        }
        const JSBI = canBeBigInt(path);
        if (JSBI !== false) {
          const operator = path.node.operator;
          if (operator.endsWith('=')) {
            const functionName = getFunctionName(operator.slice(0, -'='.length));
            if (functionName != null) {
              const left = path.node.left;
              const right = path.node.right;
              if (types.isMemberExpression(left)) {
                // object[property] += right -> (x = object, y = property, x[y] = x[y] + right)
                const expressions = [];
                let x = left.object;
                if (!isConstant(path.get('left').get('object'))) {
                  x = path.scope.generateUidIdentifier('x');
                  path.scope.push({id: x});
                  expressions.push(types.assignmentExpression('=', x, left.object));
                }
                let y = left.property;
                if (!isConstant(path.get('left').get('property'))) {
                  y = path.scope.generateUidIdentifier('y');
                  path.scope.push({id: y});
                  expressions.push(types.assignmentExpression('=', y, left.property));
                }
                const assignment = types.assignmentExpression('=',
                  types.memberExpression(x, y, left.computed),
                  types.callExpression(
                    types.memberExpression(types.identifier(JSBI), types.identifier(functionName)),
                    [types.memberExpression(x, y, left.computed), right]
                  )
                );
                expressions.push(assignment);
                if (expressions.length === 1) {
                  path.replaceWith(expressions[0]);
                } else {
                  path.replaceWith(types.sequenceExpression(expressions));
                }
              } else {
                // left += right -> (left = left + right)
                path.replaceWith(types.assignmentExpression('=', left, types.callExpression(types.memberExpression(types.identifier(JSBI), types.identifier(functionName)), [left, right])));
              }
            }
          }
        }
      },
      Program: function (path) {
        // https://stackoverflow.com/a/35994497
        const identifier = types.identifier(JSBI);
        const importDefaultSpecifier = types.importDefaultSpecifier(identifier);
        const importDeclaration = types.importDeclaration([importDefaultSpecifier], types.stringLiteral(IMPORT_PATH));
        path.unshiftContainer('body', importDeclaration);
      },
      Identifier: function (path) {
        if (path.node.name === 'eval') {
          throw new RangeError('eval should not be used');
        }
      }
    },
    pre: function () {
      visited.clear();
      typeOfIgnore.clear();
    },
    post: function (state) {
      //console.log(state);
      const usesMaybeJSBI = state.path.toString().indexOf('maybeJSBI') !== -1;
      if (usesMaybeJSBI) {
        state.ast.program.body.unshift(babel.parse(maybeJSBICode).program.body[0]);
      }
    }
  };
};
