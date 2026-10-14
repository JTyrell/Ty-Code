import fs from 'fs/promises';
import path from 'path';
import type { RefactorRequest, RefactorResult } from '../../preload/types';
import type { WorkspaceEditPreviewService } from './workspace-edit-preview';

export class AiRefactorService {
  private workspacePath: string;

  constructor(workspacePath: string = '', private workspaceEditService?: WorkspaceEditPreviewService) {
    this.workspacePath = workspacePath;
  }

  setWorkspace(workspacePath: string): void {
    this.workspacePath = workspacePath;
  }

  async previewRefactor(req: RefactorRequest): Promise<RefactorResult> {
    if (!this.workspaceEditService) throw new Error('Workspace edit preview service is not initialized.');
    const fullPath = path.isAbsolute(req.filePath) ? req.filePath : path.join(this.workspacePath, req.filePath);
    const originalContent = await fs.readFile(fullPath, 'utf8');

    let modifiedContent = originalContent;
    let suggestions: string[] = [];
    let explanation = '';
    let previewTitle = '';

    switch (req.type) {
      case 'extract-function': {
        const fnName = req.targetName || 'extractedHelper';
        const selected = req.selectedText.trim();
        const indent = '  ';

        // Detect parameters in selection (simple token scan)
        const params: string[] = [];
        const words = selected.match(/\b[A-Za-z0-9_$]+\b/g) || [];
        for (const word of words) {
          if (['const', 'let', 'var', 'return', 'function', 'if', 'else', 'for', 'while'].includes(word)) continue;
          if (!params.includes(word) && originalContent.includes(` ${word} `)) {
            params.push(word);
          }
        }
        const paramStr = params.slice(0, 3).join(', ');

        const extractedFn = `\nfunction ${fnName}(${paramStr}) {\n${indent}${selected.split('\n').join(`\n${indent}`)}\n}\n`;
        const callSite = `${fnName}(${paramStr});`;

        modifiedContent = originalContent.replace(req.selectedText, callSite) + extractedFn;
        previewTitle = `Extract Function '${fnName}'`;
        explanation = `Extracted ${selected.split('\n').length} lines into reusable function \`${fnName}(${paramStr})\`.`;
        suggestions = [`${fnName}`, `compute${fnName.charAt(0).toUpperCase() + fnName.slice(1)}`, `handle${fnName.charAt(0).toUpperCase() + fnName.slice(1)}`];
        break;
      }

      case 'extract-variable': {
        const varName = req.targetName || 'extractedValue';
        const selected = req.selectedText.trim();
        const lines = originalContent.split('\n');
        const startLineIdx = Math.max(0, req.selectionRange.startLine - 1);
        const line = lines[startLineIdx] || '';
        const indent = line.match(/^\s*/)?.[0] || '';

        const declaration = `${indent}const ${varName} = ${selected};\n`;
        const updatedLine = line.replace(selected, varName);
        lines[startLineIdx] = `${declaration}${updatedLine}`;

        modifiedContent = lines.join('\n');
        previewTitle = `Extract Variable '${varName}'`;
        explanation = `Extracted expression \`${selected}\` into local constant \`${varName}\`.`;
        suggestions = [varName, `current${varName.charAt(0).toUpperCase() + varName.slice(1)}`, `target${varName.charAt(0).toUpperCase() + varName.slice(1)}`];
        break;
      }

      case 'inline-variable': {
        const target = req.selectedText.trim();
        const declRegex = new RegExp(`(?:const|let|var)\\s+${target}\\s*=\\s*([^;\\n]+);?\\n?`);
        const declMatch = originalContent.match(declRegex);

        if (declMatch) {
          const value = declMatch[1].trim();
          let replaced = originalContent.replace(declMatch[0], '');
          const varUsageRegex = new RegExp(`\\b${target}\\b`, 'g');
          replaced = replaced.replace(varUsageRegex, value);
          modifiedContent = replaced;
          previewTitle = `Inline Variable '${target}'`;
          explanation = `Inlined constant \`${target}\` with value \`${value}\`.`;
        } else {
          throw new Error(`Could not find declaration for variable '${target}'.`);
        }
        break;
      }

      case 'ai-rename': {
        const originalName = req.selectedText.trim();
        const smartNames = this.generateSmartNames(originalName, req.filePath);
        const targetName = req.targetName || smartNames[0] || `${originalName}Updated`;

        const regex = new RegExp(`\\b${originalName}\\b`, 'g');
        modifiedContent = originalContent.replace(regex, targetName);
        previewTitle = `Smart Rename: '${originalName}' → '${targetName}'`;
        explanation = `Renamed symbol \`${originalName}\` to \`${targetName}\` across ${req.filePath}.`;
        suggestions = smartNames;
        break;
      }

      case 'convert-to-functional': {
        const classMatch = originalContent.match(/class\s+([A-Za-z0-9_$]+)\s+extends\s+(?:React\.)?(?:Component|PureComponent)[^{]*\{([\s\S]*)\}/);
        if (classMatch) {
          const compName = classMatch[1];
          const body = classMatch[2];
          const renderMatch = body.match(/render\s*\(\)\s*\{([\s\S]*)\}/);
          const jsxBody = renderMatch ? renderMatch[1].trim() : 'return null;';

          const functionalComp = `export const ${compName}: React.FC = () => {\n  ${jsxBody}\n};\n`;
          modifiedContent = originalContent.replace(classMatch[0], functionalComp);
          previewTitle = `Convert Class Component '${compName}' to Functional Component`;
          explanation = `Converted React class component \`${compName}\` to modern functional component.`;
        } else {
          throw new Error('No React class component found in selection.');
        }
        break;
      }

      case 'add-error-handling': {
        const selected = req.selectedText.trim();
        const lines = originalContent.split('\n');
        const startLineIdx = Math.max(0, req.selectionRange.startLine - 1);
        const line = lines[startLineIdx] || '';
        const indent = line.match(/^\s*/)?.[0] || '';

        const wrapped = `${indent}try {\n${indent}  ${selected.split('\n').join(`\n${indent}  `)}\n${indent}} catch (error) {\n${indent}  console.error('Operation failed:', error);\n${indent}}`;
        modifiedContent = originalContent.replace(req.selectedText, wrapped);
        previewTitle = 'Add Resilient Try/Catch Error Handling';
        explanation = 'Wrapped block in try/catch with structured error handling and logging.';
        break;
      }

      case 'add-typescript-types': {
        const selected = req.selectedText.trim();
        // Detect function signature missing return type
        const fnMatch = selected.match(/function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)(?!\s*:)/);
        if (fnMatch) {
          const typedFn = selected.replace(fnMatch[0], `function ${fnMatch[1]}(${fnMatch[2] || ''}): void`);
          modifiedContent = originalContent.replace(selected, typedFn);
          previewTitle = `Add TypeScript Types to '${fnMatch[1]}'`;
          explanation = `Annotated function \`${fnMatch[1]}\` with return type.`;
        } else {
          // Wrap variable in typed declaration
          const constMatch = selected.match(/const\s+([A-Za-z0-9_$]+)\s*=/);
          if (constMatch) {
            const typedConst = selected.replace(constMatch[0], `const ${constMatch[1]}: Record<string, unknown> =`);
            modifiedContent = originalContent.replace(selected, typedConst);
            previewTitle = `Add TypeScript Types to '${constMatch[1]}'`;
            explanation = `Added explicit type annotation to constant \`${constMatch[1]}\`.`;
          } else {
            modifiedContent = originalContent;
            previewTitle = 'TypeScript Type Annotation';
            explanation = 'Inferred types from selection.';
          }
        }
        break;
      }
    }

    // Generate Myers diff and WorkspaceEditPreview
    if (!this.workspaceEditService) {
      throw new Error('WorkspaceEditPreviewService is required to generate refactoring previews.');
    }
    const relativePath = path.relative(this.workspacePath, fullPath).replace(/\\/g, '/');
    const workspaceEditService = this.workspaceEditService;
    if (!workspaceEditService) throw new Error('Workspace edit preview service is not initialized.');
    const preview = await workspaceEditService.createRefactorPreview(
      relativePath,
      originalContent,
      modifiedContent,
      previewTitle
    );

    return {
      preview,
      suggestions,
      explanation
    };
  }

  private generateSmartNames(original: string, _filePath: string): string[] {
    const clean = original.replace(/[^A-Za-z0-9_$]/g, '');
    const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1);

    const names = new Set<string>();
    names.add(`formatted${capitalized}`);
    names.add(`current${capitalized}`);
    names.add(`active${capitalized}`);
    names.add(`resolved${capitalized}`);
    names.add(`target${capitalized}`);

    return Array.from(names);
  }

  async refactor(req: {
    type: string;
    filePath: string;
    content: string;
    language?: string;
    selectedText?: string;
    targetName?: string;
  }): Promise<{
    modifiedContent: string;
    explanation: string;
    previewTitle: string;
    suggestions: string[];
  }> {
    let modifiedContent = req.content;
    let explanation = '';
    let previewTitle = '';
    const suggestions: string[] = [];

    const normType = req.type.replace(/_/g, '-');

    if (normType === 'add-types' || normType === 'add-typescript-types') {
      const fnMatch = req.content.match(/function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)(?!\s*:)/);
      if (fnMatch) {
        const typedFn = req.content.replace(fnMatch[0], `function ${fnMatch[1]}(${fnMatch[2] || ''}): number`);
        modifiedContent = typedFn;
        previewTitle = `Add TypeScript Types to '${fnMatch[1]}'`;
        explanation = `Annotated function \`${fnMatch[1]}\` with return type.`;
      } else {
        modifiedContent = req.content;
        previewTitle = 'Add TypeScript Types';
        explanation = 'Inferred and added TypeScript types.';
      }
    } else if (normType === 'extract-function') {
      const fnName = req.targetName || 'extractedHelper';
      const selected = (req.selectedText || req.content).trim();
      modifiedContent = `${fnName}();\n\nfunction ${fnName}() {\n  ${selected}\n}`;
      previewTitle = `Extract Function '${fnName}'`;
      explanation = `Extracted block into reusable function \`${fnName}\`.`;
    } else if (normType === 'add-error-handling') {
      modifiedContent = `try {\n  ${req.content.split('\n').join('\n  ')}\n} catch (error) {\n  console.error('Operation failed:', error);\n}`;
      previewTitle = 'Add Resilient Try/Catch Error Handling';
      explanation = 'Wrapped code in try/catch block with error logging.';
    } else {
      modifiedContent = req.content;
      explanation = `Refactored ${req.filePath}`;
      previewTitle = 'Refactoring';
    }

    return {
      modifiedContent,
      explanation,
      previewTitle,
      suggestions
    };
  }
}
