import { Awaitable, camelize, capitalize, defineProperty, Dict, hyphenate, isNullable } from 'cosmokit'
import { isType } from './utils'

const kElement = Symbol('element')

function isElement(source: any): source is Element {
  return source && typeof source === 'object' && source[kElement]
}

function toElement(content: string | Element) {
  if (typeof content !== 'string') return content
  return Element('text', { content })
}

function toElementArray(input: Element.Content) {
  if (typeof input === 'string' || isElement(input)) {
    return [toElement(input)]
  } else if (Array.isArray(input)) {
    return input.map(toElement)
  }
}

interface Element {
  [kElement]: true
  type: string
  attrs: Dict<string>
  /** @deprecated use `attrs` instead */
  data: Dict<string>
  children: Element[]
  toString(): string
}

interface ElementConstructor extends Element {}

class ElementConstructor {
  get data() {
    return this.attrs
  }

  toString() {
    if (!this.type) return this.children.join('')
    if (this.type === 'text') return Element.escape(this.attrs.content)
    const attrs = Object.entries(this.attrs).map(([key, value]) => {
      if (isNullable(value)) return ''
      key = hyphenate(key)
      if (value === '') return ` ${key}`
      return ` ${key}="${Element.escape(value, true)}"`
    }).join('')
    if (!this.children.length) return `<${this.type}${attrs}/>`
    return `<${this.type}${attrs}>${this.children.join('')}</${this.type}>`
  }
}

defineProperty(ElementConstructor, 'name', 'Element')

function Element(type: string, children?: Element.Content): Element
function Element(type: string, attrs: Dict<any>, children?: Element.Content): Element
function Element(type: string, ...args: any[]) {
  const el = Object.create(ElementConstructor.prototype)
  let attrs: Dict<string> = {}, children: Element[] = []
  if (args[0] && typeof args[0] === 'object' && !isElement(args[0]) && !Array.isArray(args[0])) {
    for (const [key, value] of Object.entries(args.shift())) {
      if (isNullable(value)) continue
      if (value === true) {
        attrs[key] = ''
      } else if (value === false) {
        attrs['no' + capitalize(key)] = ''
      } else {
        attrs[key] = '' + value
      }
    }
  }
  if (args[0]) children = toElementArray(args[0])
  return Object.assign(el, { type, attrs, children })
}

namespace Element {
  export type Content = string | Element | (string | Element)[]
  export type Transformer = boolean | Content | ((element: Element, index: number, array: Element[]) => boolean | Content)
  export type AsyncTransformer = boolean | Content | ((element: Element, index: number, array: Element[]) => Awaitable<boolean | Content>)

  export function escape(source: string, inline = false) {
    const result = source
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return inline
      ? result.replace(/"/g, '&quot;')
      : result
  }

  export function unescape(source: string) {
    return source
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
  }

  type Combinator = ' ' | '>' | '+' | '~'

  export interface Selector {
    type: string
    combinator: Combinator
  }

  const combRegExp = / *([ >+~]) */g

  export function parseSelector(input: string): Selector[][] {
    return input.split(',').map((query) => {
      const selectors: Selector[] = []
      query = query.trim()
      let combCap: RegExpExecArray, combinator: Combinator = ' '
      while ((combCap = combRegExp.exec(query))) {
        selectors.push({ type: query.slice(0, combCap.index), combinator })
        combinator = combCap[1] as Combinator
        query = query.slice(combCap.index + combCap[0].length)
      }
      selectors.push({ type: query, combinator })
      return selectors
    })
  }

  export function select(source: string | Element[], query: string) {
    if (typeof source === 'string') source = parse(source)
    return [..._select(source, parseSelector(query))]
  }

  function *_select(elements: Element[], query: Selector[][]): Generator<Element, null> {
    if (!query.length) return
    let adjacent: Selector[][] = []
    for (const [index, { type, children }] of elements.entries()) {
      const inner: Selector[][] = []
      const local = [...query, ...adjacent]
      adjacent = []
      for (const group of local) {
        const selector = group[0]
        if (type === selector.type) {
          if (group.length === 1) {
            yield elements[index]
          } else if ([' ', '>'].includes(group[1].combinator)) {
            inner.push(group.slice(1))
          } else if (group[1].combinator === '+') {
            adjacent.push(group.slice(1))
          } else {
            query.push(group.slice(1))
          }
        }
        if (selector.combinator === ' ') {
          inner.push(group)
        }
      }
      yield *_select(children, inner)
    }
  }

  const tagRegExp = /<(\/?)\s*([^\s>]+)([^>]*?)\s*(\/?)>/
  const attrRegExp = /([^\s=]+)(?:="([^"]*)")?/g

  interface Token {
    tag: string
    close: string
    empty: string
    attrs: Dict<string>
  }

  export function parse(source: string) {
    const tokens: (string | Token)[] = []
    let tagCap: RegExpExecArray
    while ((tagCap = tagRegExp.exec(source))) {
      if (tagCap.index) {
        tokens.push(unescape(source.slice(0, tagCap.index)))
      }
      const [_, close, tag, attrs, empty] = tagCap
      const token: Token = { tag, close, empty, attrs: {} }
      let attrCap: RegExpExecArray
      while ((attrCap = attrRegExp.exec(attrs))) {
        const [_, key, value = ''] = attrCap
        token.attrs[camelize(key)] = unescape(value)
      }
      tokens.push(token)
      source = source.slice(tagCap.index + tagCap[0].length)
    }
    if (source) tokens.push(source)
    const stack = [Element(null)]
    for (const token of tokens) {
      if (typeof token === 'string') {
        stack[0].children.push(toElement(token))
      } else if (token.close) {
        stack.shift()
      } else {
        const element = Element(token.tag, token.attrs)
        stack[0].children.push(element)
        if (!token.empty) stack.unshift(element)
      }
    }
    return stack[stack.length - 1].children
  }

  export function transform(source: string | Element[], rules: Dict<Transformer>) {
    const elements = typeof source === 'string' ? parse(source) : source
    const children: Element[] = []
    elements.forEach((element, index, elements) => {
      let result = rules[element.type] ?? rules.default ?? true
      if (typeof result === 'function') {
        result = result(element, index, elements)
      }
      if (result === true) {
        const { type, attrs, children } = element
        children.push(Element(type, attrs, transform(children, rules)))
      } else if (result !== false) {
        children.push(...toElementArray(result))
      }
    })
    return children
  }

  export async function transformAsync(source: string | Element[], rules: Dict<AsyncTransformer>): Promise<Element[]> {
    const elements = typeof source === 'string' ? parse(source) : source
    return (await Promise.all(elements.map(async (element, index, elements) => {
      let result = rules[element.type] ?? rules.default ?? true
      if (typeof result === 'function') {
        result = await result(element, index, elements)
      }
      if (result === true) {
        const { type, attrs, children } = element
        return [Element(type, attrs, await transformAsync(children, rules))]
      } else if (result !== false) {
        return toElementArray(result)
      } else {
        return []
      }
    }))).flat(1)
  }

  export type Factory<R extends any[]> = (...args: [...rest: R, attrs?: Dict<any>]) => Element

  function createFactory<R extends any[] = any[]>(type: string, ...keys: string[]): Factory<R> {
    return (...args: any[]) => {
      const element = Element(type)
      keys.forEach((key, index) => {
        if (!isNullable(args[index])) {
          element.attrs[key] = args[index]
        }
      })
      if (args[keys.length]) {
        Object.assign(element.attrs, args[keys.length])
      }
      return element
    }
  }

  function createAssetFactory(type: string): Factory<[data: string | Buffer | ArrayBuffer]> {
    return (value, attrs = {}) => {
      if (isType('Buffer', value)) {
        value = 'base64://' + value.toString('base64')
      } else if (isType('ArrayBuffer', value)) {
        value = 'base64://' + Buffer.from(value).toString('base64')
      }
      return Element(type, { ...attrs, url: value })
    }
  }

  export const at = createFactory<[id: any]>('at', 'id')
  export const sharp = createFactory<[id: any]>('sharp', 'id')
  export const quote = createFactory<[id: any]>('quote', 'id')
  export const image = createAssetFactory('image')
  export const video = createAssetFactory('video')
  export const audio = createAssetFactory('audio')
  export const file = createAssetFactory('file')
}

export = Element