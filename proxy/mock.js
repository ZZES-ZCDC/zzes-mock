'use strict'

const { Mock } = require('../models')

module.exports = class MockProxy {
  static newAndSave (docs) {
    return Mock.insertMany(docs)
  }

  static getById (mockId) {
    return Mock.findById(mockId).populate('project')
  }

  /**
   * 更具productId查询url
   */
  static find (query, opt) {
    return Mock.find(query, {}, opt).populate('project')
  }

  static findOne (query, opt) {
    return Mock.findOne(query, {}, opt).populate('project')
  }

  static updateById (mock) {
    return Mock.update({
      _id: mock.id
    }, {
      $set: {
        url: mock.url,
        mode: mock.mode,
        method: mock.method,
        parameters: mock.parameters,
        description: mock.description,
        response_model: mock.response_model,
        params: mock.params,
        tag: mock.tag
      }
    })
  }

  static updateMany (docs) {
    return Promise.all(docs.map(item => this.updateById(item)))
  }

  static delByIds (mockIds) {
    return Mock.remove({
      _id: {
        $in: mockIds
      }
    })
  }

  static del (query) {
    return Mock.remove(query)
  }
}
