'use strict'

const config = require('config')
const ipFilter = require('ip-filter')
const pathToRegexp = require('path-to-regexp')

const blackProjects = config.get('blackList.projects')
const blackIPs = config.get('blackList.ips')

/**
 * 状态码
 */
const codeMap = {
  '-1': 'fail',
  '200': 'success',
  '401': 'token expired',
  '500': 'server error',
  '10001': 'params error'
}

/**
 * 返回体封装
 */
const utilFn = {
  /**
   * 成功返回体
   * @param {*} data 
   */
  resuccess (data) {
    return {
      code: 200,
      success: true,
      message: codeMap['200'],
      data: data || null
    }
  },
  
  /**
   * 错误返回体
   * @param {*} message 
   * @param {*} code 
   * @param {*} data 
   */
  refail (message, code, data) {
    return {
      code: code || -1,
      success: false,
      message: message || codeMap[code],
      data: data || null
    }
  }
}

module.exports = class Middleware {
  static util (ctx, next) {
    ctx.set('X-Request-Id', ctx.req.id)
    ctx.util = utilFn
    return next()
  }

  /**
   * ip过滤
   * @param {Object} ctx 
   * @param {Object} next 
   */
  static ipFilter (ctx, next) {
    if (ipFilter(ctx.ip, blackIPs, {strict: false})) {
      ctx.body = utilFn.refail('请求频率太快，已被限制访问')
      return
    }
    return next()
  }

  /**
   * mock url过滤
   * @param {Object} ctx 
   * @param {Object} next 
   */
  static mockFilter (ctx, next) {
    // 获取url中的projectId和mockurl
    const pathNode = pathToRegexp('/mock/:projectId(.{24})/:mockURL*').exec(ctx.path)

    if (!pathNode) ctx.throw(404)
    if (blackProjects.indexOf(pathNode[1]) !== -1) {
      ctx.body = ctx.util.refail('接口请求频率太快，已被限制访问')
      return
    }
    // 分离放入对象
    ctx.pathNode = {
      projectId: pathNode[1],
      mockURL: '/' + (pathNode[2] || '')
    }

    return next()
  }
}
