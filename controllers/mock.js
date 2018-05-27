'use strict'

const _ = require('lodash')
const { VM } = require('vm2')
const nodeURL = require('url')
const JSZip = require('jszip')
const Mock = require('mockjs')
const axios = require('axios')
const config = require('config')
const pathToRegexp = require('path-to-regexp')
// 引入校验插件
const Parameter = require('parameter')
const parameter = new Parameter()

const util = require('../util')
const ft = require('../models/fields_table') // 过滤数据
const { MockProxy, ProjectProxy, UserGroupProxy } = require('../proxy')

const redis = util.getRedis()
const defPageSize = config.get('pageSize')

async function checkByMockId (mockId, uid) {
  const api = await MockProxy.getById(mockId)

  if (!api) return '接口不存在'

  const project = await checkByProjectId(api.project.id, uid)

  if (typeof project === 'string') return project
  return { api, project }
}

async function checkByProjectId (projectId, uid) {
  const project = await ProjectProxy.findOne({ _id: projectId })

  if (project) {
    const group = project.group
    if (group) {
      const userGroup = await UserGroupProxy.findOne({ user: uid, group: group })
      if (!userGroup) return '无权限操作'
    } else if (project.user.id !== uid) {
      /* istanbul ignore else */
      if (!_.find(project.members, ['id', uid])) return '无权限操作'
    }
    return project
  }

  return '项目不存在'
}

module.exports = class MockController {
  /**
   * 创建接口
   * @param Object ctx
   */

  static async create (ctx) {
    const uid = ctx.state.user.id
    // checkBody()是使用的koa-validate插件，可以直接校验请求的参数
    const mode = ctx.checkBody('mode').notEmpty().value
    const projectId = ctx.checkBody('project_id').notEmpty().value
    const description = ctx.checkBody('description').notEmpty().value
    const url = ctx.checkBody('url').notEmpty().match(/^\/.*$/i, 'URL 必须以 / 开头').value
    const method = ctx.checkBody('method').notEmpty().toLow().in(['get', 'post', 'put', 'delete', 'patch']).value
    const params = ctx.checkBody('params').notEmpty().value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByProjectId(projectId, uid)

    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    const api = await MockProxy.findOne({
      project: projectId,
      url,
      method
    })

    if (api) {
      ctx.body = ctx.util.refail('请检查接口是否已经存在')
      return
    }

    await MockProxy.newAndSave({
      project: projectId,
      description,
      method,
      url,
      mode,
      params
    })

    await redis.del('project:' + projectId)
    ctx.body = ctx.util.resuccess()
  }

  /**
   * 获取接口列表
   * @param Object ctx
   */

  static async list (ctx) {
    const uid = ctx.state.user.id
    const keywords = ctx.query.keywords
    const projectId = ctx.checkQuery('project_id').notEmpty().value
    const pageSize = ctx.checkQuery('page_size').empty().toInt().gt(0).default(defPageSize).value
    const pageIndex = ctx.checkQuery('page_index').empty().toInt().gt(0).default(1).value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const opt = {
      skip: (pageIndex - 1) * pageSize,
      limit: pageSize,
      sort: '-create_at'
    }

    const where = { project: projectId }

    if (keywords) {
      const keyExp = new RegExp(keywords)
      // console.log(keyExp)
      where.$or = [{
        url: keyExp
      }, {
        description: keyExp
      }, {
        method: keyExp
      }, {
        mode: keyExp
      },{
        params: keyExp
      }]
    }
    let mocks = await MockProxy.find(where, opt)
    let project = await ProjectProxy.getById(uid, projectId)
    /* istanbul ignore else */
    if (project) {
      project.members = project.members.map(o => _.pick(o, ft.user))
      project.extend = _.pick(project.extend, ft.projectExtend)
      project.group = _.pick(project.group, ft.group)
      project.user = _.pick(project.user, ft.user)
      project = _.pick(project, ['user'].concat(ft.project))
    }
    // 数据格式化
    mocks = mocks.map(o => _.pick(o, ft.mock))
    ctx.body = ctx.util.resuccess({ project: project || {}, mocks })
  }

  /**
   * 更新接口
   * @param Object ctx
   */

  static async update (ctx) {
    // console.log(ctx.request.body)
    const uid = ctx.state.user.id
    const id = ctx.checkBody('id').notEmpty().value
    const mode = ctx.checkBody('mode').notEmpty().value
    const description = ctx.checkBody('description').notEmpty().value
    const url = ctx.checkBody('url').notEmpty().match(/^\/.*$/i, 'URL 必须以 / 开头').value
    const method = ctx.checkBody('method').notEmpty().toLow().in(['get', 'post', 'put', 'delete', 'patch']).value
    const params = ctx.checkBody('params').notEmpty().value
    // console.log('bodyparams', params)
    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const result = await checkByMockId(id, uid)

    if (typeof result === 'string') {
      ctx.body = ctx.util.refail(result)
      return
    }

    const { api, project } = result
    api.url = url
    api.mode = mode
    api.method = method
    api.description = description
    api.params = JSON.stringify(params)
    // console.log('apiparams',api.params)
    const existMock = await MockProxy.findOne({
      _id: { $ne: api.id },
      project: project.id,
      url: api.url,
      method: api.method
    })

    if (existMock) {
      ctx.body = ctx.util.refail('接口已经存在')
      return
    }
    // console.log(api)
    await MockProxy.updateById(api)
    await redis.del('project:' + project.id)
    ctx.body = ctx.util.resuccess()
  }

  /**
   * 获取 Mock 接口
   * TODO: 可以看到请求的body体没有进行什么操作，只是用于代理请求的时候用用
   * TODO: query 主要用于jsonp获取callback参数，没用于数据校验
   * @param {*} ctx
   */
  static async getMockAPI (ctx) {
    const { query, body } = ctx.request // 获取参数
    const method = ctx.method.toLowerCase() // 请求方法小写
    const jsonpCallback = query.jsonp_param_name && (query[query.jsonp_param_name] || 'callback') // jsonp需要
    let { projectId, mockURL } = ctx.pathNode // 取出projectId 和 mockURL
    const redisKey = 'project:' + projectId // 设置redis key值
    let apiData, apis, api

    // 获取所有api ===========================================
    // 读取apis
    apis = await redis.get(redisKey) // 从redis中读取api

    if (apis) { // 如果redis中存在apis，则解析apis
      apis = JSON.parse(apis)
    } else { // 如果没有去数据库里查找对应的信息
      apis = await MockProxy.find({ project: projectId })
      // 如果数据库中存在，则存入redis
      if (apis[0]) await redis.set(redisKey, JSON.stringify(apis), 'EX', 60 * 30)
    }
    
    if (apis[0] && apis[0].project.url !== '/') {
      mockURL = mockURL.replace(apis[0].project.url, '') || '/'
    }
    
    // 过滤出api ==========================================
    api = apis.filter((item) => {
      // 格式转换
      const url = item.url.replace(/{/g, ':').replace(/}/g, '') // /api/{user}/{id} => /api/:user/:id
      return item.method === method && pathToRegexp(url).test(mockURL) 
    })[0]
    if (!api) ctx.throw(404)
    // console.log(api)

    // 传参判断
    let errors
    // 根据方法来选择参数的格式判断
    if(api.method !== 'get') { // get之外的方法
      let paramData = JSON.parse(api.params)
      let rule = {}
      for( let key in paramData) {
        // console.log(key)
        rule[key] = paramData[key][0]
      }
      errors = parameter.validate(rule, body)  
    } else { // get方法
      let paramData = JSON.parse(api.params)
      let rule = {}
      for ( let key in paramData ) {
        rule[key] = 'string' // 这地方只能判断string ， query获取到的全都是字符串类型， 所以get参数应该只能判断是否存在，不能判断类型
      }
      // 此处巨坑，query没有hasOwnProperty
      let queryObj = {}
      for ( let key in query ) {
        queryObj[key] = query[key]
      }
      errors = parameter.validate(rule, queryObj)
    }
    
    Mock.Handler.function = function (options) {
      // 转换格式
      const mockUrl = api.url.replace(/{/g, ':').replace(/}/g, '') // /api/{user}/{id} => /api/:user/:id
      options.Mock = Mock
      options._req = ctx.request
      options._req.params = util.params(mockUrl, mockURL)
      options._req.cookies = ctx.cookies.get.bind(ctx)
      return options.template.call(options.context.currentContext, options)
    }
    
    // 模式判断
    if (/^http(s)?/.test(api.mode)) { // 代理模式 需要进行http请求
      const url = nodeURL.parse(api.mode.replace(/{/g, ':').replace(/}/g, ''), true) // 转换url格式
      const params = util.params(api.url.replace(/{/g, ':').replace(/}/g, ''), mockURL) 
      const pathname = pathToRegexp.compile(url.pathname)(params)
      try {
        apiData = await axios({ // 请求代理的接口
          method: method,
          url: url.protocol + '//' + url.host + pathname,
          params: _.assign({}, url.query, query),
          data: body,
          timeout: 3000
        }).then(res => res.data)
      } catch (error) {
        ctx.body = ctx.util.refail(error.message || '接口请求失败')
        return
      }
    } else { // mock模式
      // 开虚拟机解析mock模板，生成数据
      const vm = new VM({
        timeout: 1000,
        sandbox: {
          Mock: Mock,
          mode: api.mode,
          template: new Function(`return ${api.mode}`) // eslint-disable-line
        }
      })
      vm.run('Mock.mock(new Function("return " + mode)())') // 数据验证，检测 setTimeout 等方法
      apiData = vm.run('Mock.mock(template())') // 解决正则表达式失效的问题
      
      /* istanbul ignore else */
      if (apiData._res) { // 自定义响应 Code, 看来_res是用来放自定义字段的
        let _res = apiData._res
        ctx.status = _res.status || /* istanbul ignore next */ 200
        /* istanbul ignore else */
        if (_res.cookies) {
          for (let i in _res.cookies) {
            /* istanbul ignore else */
            if (_res.cookies.hasOwnProperty(i)) ctx.cookies.set(i, _res.cookies[i])
          }
        }
        /* istanbul ignore next */
        if (_res.headers) {
          for (let i in _res.headers) {
            /* istanbul ignore next */
            if (_res.headers.hasOwnProperty(i)) ctx.set(i, _res.headers[i])
          }
        }
        /* istanbul ignore next */
        if (_res.status && parseInt(_res.status, 10) !== 200 && _res.data) apiData = _res.data
        delete apiData['_res']
      }
    }

    await redis.lpush('mock.count', api._id)
    if(errors) {
      ctx.body = errors
    } else {
      if (jsonpCallback) { // jsonp请求返回数据格式
        ctx.type = 'text/javascript'
        ctx.body = `${jsonpCallback}(${JSON.stringify(apiData, null, 2)})`
          .replace(/\u2028/g, '\\u2028')
          .replace(/\u2029/g, '\\u2029') // JSON parse vs eval fix. https://github.com/rack/rack-contrib/pull/37
      } else { // 正常返回数据格式
        ctx.body = apiData
      }
    }
  }

  /**
   * Easy Mock CLI 依赖该接口获取接口数据
   * @param Object ctx
   */

  static async getAPIByProjectIds (ctx) {
    let projectIds = ctx.checkQuery('project_ids').notEmpty().value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    projectIds = projectIds.split(',')

    const apis = await MockProxy.find({
      project: {
        $in: projectIds
      }
    })

    const projects = await ProjectProxy.findByIds(projectIds)

    const result = {}

    projects.forEach((project) => {
      const projectId = project.id
      let newMocks = apis.filter(o => (o.project.id === projectId))
      let newProject = projects.filter(o => (o.id === projectId))[0]

      newProject.members = newProject.members.map(o => _.pick(o, ft.user))
      newProject.user = _.pick(newProject.user, ft.user)
      newProject = _.pick(newProject, ['user'].concat(ft.project))
      newMocks = newMocks.map(o => _.pick(o, ft.mock))

      result[projectId] = {
        project: newProject,
        mocks: newMocks
      }
    })

    ctx.body = ctx.util.resuccess(result)
  }

  /**
   * 接口导出
   * @param Object ctx
   */

  static async exportAPI (ctx) {
    const zip = new JSZip()
    const ids = ctx.checkBody('ids').empty().type('array').value
    const projectId = ctx.checkBody('project_id').empty().value
    let apis

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    if (projectId) {
      apis = await MockProxy.find({ project: projectId })
    } else if (!_.isEmpty(ids)) {
      apis = await MockProxy.find({
        _id: {
          $in: ids
        }
      })
    } else {
      ctx.body = ctx.util.refail('参数不能为空')
      return
    }

    if (_.isEmpty(apis)) {
      ctx.body = ctx.util.refail('没有可导出的接口')
      return
    }

    apis.forEach((api) => {
      zip.file(`${api.project.url}${api.url}.json`, api.mode)
    })

    const content = await zip.generateAsync({ type: 'nodebuffer' })

    ctx.set('Content-disposition', 'attachment; filename=Easy-Mock-API.zip')
    ctx.body = content
  }

  /**
   * 删除接口
   * @param Object ctx
   */

  static async delete (ctx) {
    const uid = ctx.state.user.id
    const projectId = ctx.checkBody('project_id').notEmpty().value
    const ids = ctx.checkBody('ids').notEmpty().type('array').value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByProjectId(projectId, uid)

    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    await MockProxy.find({
      _id: {
        $in: ids
      },
      project: projectId
    })

    await MockProxy.delByIds(ids)
    await redis.del('project:' + projectId)
    ctx.body = ctx.util.resuccess()
  }
}
