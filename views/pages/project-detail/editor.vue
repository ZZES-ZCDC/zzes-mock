<template>
  <transition name="fade">
    <div class="em-editor" v-show="value.show">
      <div class="em-editor__editor">
        <div ref="codeEditor"></div>
      </div>
      <div class="panel-info">
        <em-spots :size="10"></em-spots>
        <div class="wrapper">
          <h2>{{isEdit ? $t('p.detail.editor.title[0]') : $t('p.detail.editor.title[1]')}}</h2>
          <div class="em-editor__form">
            <Form label-position="top">
              <!-- line 1 -->
              <Row>
                <Col span="12">
                  <!-- 请求方法选择 -->
                  <Form-item label="Method">
                    <i-select v-model="temp.method">
                      <Option v-for="item in methods" :value="item.value" :key="item.value">{{ item.label }}</Option>
                    </i-select>
                  </Form-item>
                </Col>
                <Col span="12">
                  <!-- 请求url -->
                  <Form-item label="URL">
                    <i-input v-model="temp.url">
                      <span slot="prepend">/</span>
                    </i-input>
                  </Form-item>
                </Col>  
              </Row>
              <!-- line 2 -->
              <!-- 请求描述 -->
              <Form-item :label="$t('p.detail.columns[0]')">
                <i-input v-model="temp.description"></i-input>
              </Form-item>  
              <!-- 是否自动关闭 -->
              <Form-item :label="$t('p.detail.editor.autoClose')" v-if="isEdit">
                <i-switch v-model="autoClose"></i-switch>
              </Form-item>
             
              
              <!-- 参数列表 除了get方法外才显示-->
              <Form-item :label="$t('p.detail.editor.paramsList')" v-if="temp.method!=='get'">
                <Button style="width:100%" type="ghost" @click="handleAdd">+</Button>
                <div class="box">
                  <div v-for="(item, index) in formDynamic.items" :key="index" v-if="item.status">
                    <Row>
                      <Col span="7">
                        <Input type="text" v-model="item.value" placeholder="参数名称"/>
                      </Col>
                      <Col span="7">
                        <i-select v-model="item.paramType" placeholder="请选择参数类型">
                          <Option v-for="item in paramTypes" :value="item.type" :key="item.type">{{ item.type }}</Option>
                        </i-select>
                      </Col>
                      <Col span="7">
                        <Input type="text" v-model="item.info" placeholder="参数说明"/>
                      </Col>
                      <Col span="2" offset="1">
                        <Button type="ghost" @click="handleRemove(index)">-</Button>
                      </Col>
                    </Row>
                  </div>         
                </div>
                <!-- <Button type="ghost" @click="getParams">push</Button> -->
              </Form-item>
              
              <!-- 提交按钮 -->
              <Form-item>
                <Button type="primary" long @click="submit">{{isEdit ? $t('p.detail.editor.action[0]') : $t('p.detail.editor.action[1]')}}</Button>
              </Form-item>
            </Form>
          </div>
          <div class="em-editor__control">
            <div class="em-proj-detail__switcher">
              <ul>
                <!-- 格式化 预览 关闭 三个按钮 -->
                <li @click="format">{{$t('p.detail.editor.control[0]')}}</li> 
                <li @click="preview" v-if="isEdit">{{$t('p.detail.editor.control[1]')}}</li>
                <li @click="close">{{$t('p.detail.editor.control[2]')}}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
import * as api from '../../api'
import jsBeautify from 'js-beautify/js/lib/beautify'
let ace

if (typeof window !== 'undefined') {
  ace = require('brace')
  require('brace/mode/javascript')
  require('brace/theme/monokai')
  require('brace/ext/language_tools')
  require('brace/ext/searchbox')
  require('./snippets')
}

export default {
  props: {
    value: {}
  },
  data () {
    return {
      codeEditor: null,
      autoClose: true,
      methods: [
        { label: 'get', value: 'get' },
        { label: 'post', value: 'post' },
        { label: 'put', value: 'put' },
        { label: 'delete', value: 'delete' },
        { label: 'patch', value: 'patch' }
      ],
      // 传参form里的数据类型
      paramTypes: [
        { type: 'int' },
        { type: 'string' },
        { type: 'email' },
        { type: 'boolean' },
        { type: 'array' },
        { type: 'object' },
        { type: 'date' },
        { type: 'datetime' }
      ],
      temp: {
        url: '',
        mode: '',
        method: '',
        description: '',
        params: {}
      },
      index: 1,
      // 传参的form
      formDynamic: {
        items: [{
          value: '',
          paramType: '',
          info: '',
          index: 1,
          status: 1
        }]
      }
    }
  },
  computed: {
    isEdit () {
      return !!this.value._id
    }
  },
  mounted () {
    this.codeEditor = ace.edit(this.$refs.codeEditor)
    this.codeEditor.getSession().setMode('ace/mode/javascript')
    this.codeEditor.setTheme('ace/theme/monokai')
    this.codeEditor.setOption('tabSize', 2)
    this.codeEditor.setOption('fontSize', 15)
    this.codeEditor.setOption('enableLiveAutocompletion', true)
    this.codeEditor.setOption('enableSnippets', true)
    this.codeEditor.clearSelection()
    this.codeEditor.getSession().setUseWorker(false)
    this.codeEditor.on('change', this.onChange)
    this.codeEditor.commands.addCommand({
      name: 'save',
      bindKey: {win: 'Ctrl-S', mac: 'Command-S'},
      exec: () => {
        this.submit()
      }
    })
  },
  watch: {
    /**
     * 当点击编辑按钮，弹出编辑层，即会触发数据填充
     */
    'value.show': function (show) {
      document.body.style.overflow = show ? 'hidden' : 'auto'
      if (show) {
        if (this.isEdit) {
          // console.log(this.value)
          this.autoClose = true
          this.temp.url = this.value.url.slice(1) // remove /
          this.temp.mode = this.value.mode
          this.temp.method = this.value.method
          this.temp.description = this.value.description
          this.temp.params = this.value.params
          // console.log(this.temp.params)
          this.setParams(this.value.params) // 填充数据列表
          this.codeEditor.setValue(this.temp.mode)
        } else {
          this.temp.url = ''
          this.temp.mode = '{"data": {}}'
          this.temp.method = 'get'
          this.temp.description = ''
          this.temp.params = ''
          this.codeEditor.setValue(this.temp.mode)
        }
        this.format()
      }
    }
  },
  methods: {
    convertUrl (url) {
      const newUrl = '/' + url
      return newUrl === '/'
        ? '/'
        : newUrl.replace(/\/\//g, '/').replace(/\/$/, '')
    },
    format () {
      const context = this.codeEditor.getValue()
      let code = /^http(s)?/.test(context)
        ? context
        : jsBeautify.js_beautify(context, { indent_size: 2 })
      this.codeEditor.setValue(code)
    },
    onChange () {
      this.temp.mode = this.codeEditor.getValue()
    },
    close () {
      this.value.show = false
      this.$emit('input', this.value)
    },
    submit () {
      const mockUrl = this.convertUrl(this.temp.url)

      try {
        // 获取编辑器里的mock表达式
        const value = (new Function(`return ${this.temp.mode}`))() // eslint-disable-line
        if (!value) {
          this.$Message.error(this.$t('p.detail.editor.submit.error[0]'))
          return
        } else if (typeof value !== 'object') {
          throw new Error()
        }
      } catch (error) {
        if (!/^http(s)?:\/\//.test(this.temp.mode)) {
          this.$Message.error(error.message || this.$t('p.detail.editor.submit.error[1]'))
          return
        }
      }
      if (this.isEdit) { // 更新接口数据
        this.temp.params = this.getParams()
        api.mock.update({
          data: {
            ...this.temp,
            id: this.value._id,
            url: mockUrl
          }
        }).then((res) => {
          if (res.data.success) {
            this.$Message.success(this.$t('p.detail.editor.submit.updateSuccess'))
            this.value.url = mockUrl
            this.value.mode = this.temp.mode
            this.value.method = this.temp.method
            this.value.description = this.temp.description
            this.value.params = this.temp.params
            if (this.autoClose) this.close()
          }
        })
      } else {
        this.temp.params = JSON.stringify(this.getParams())
        // 若不是更新，则创建
        this.$store.dispatch('mock/CREATE', {
          route: this.$route,
          ...this.temp,
          url: mockUrl
        }).then((res) => {
          if (res.data.success) {
            this.$Message.success(this.$t('p.detail.create.success'))
            this.close()
          }
        })
      }
    },
    preview () {
      window.open(this.$parent.baseUrl + this.value.url + '#!method=' + this.value.method)
    },
    handleAdd () {
      this.index++
      this.formDynamic.items.push({
        value: '',
        index: this.index,
        status: 1
      })
    },
    handleRemove (index) {
      this.formDynamic.items[index].status = 0
    },
    /**
     * 格式化参数列表数据
     */
    getParams () {
      let obj = {}
      this.formDynamic.items.map((v, i) => {
        if (v.status === 1) {
          obj[v.value] = [v.paramType, v.info]
        }
      })
      // console.log(arr)
      return obj
    },
    /**
     * 将获取到的值放入到参数列表中
     * @param {String} params
     */
    setParams (params) {
      let data = JSON.parse(params)
      // console.log(data)
      this.formDynamic.items = []
      for (let i in data) {
        this.formDynamic.items.push({
          value: i,
          paramType: data[i][0],
          info: data[i][1],
          index: 1,
          status: 1
        })
      }
      return this.formDynamic.items
    }
  }
}
</script>
