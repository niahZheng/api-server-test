const df = require('dataframe-js')
const HashMap = require('hashmap')

function produceMapping(dataframe, columnName, dbMethod, headers) {
  const distinctValues = dataframe.distinct(columnName).toArray()
  return dbMethod(distinctValues, headers)
}

function createHashMap(data) {
  const output = []
  const map = data.map((x) => {
    if ('name' in x) {
      output.push([x.name, x.id])
    }
  })
  return new HashMap(output)
}

function produceMappers(data, requiredColumns, dbMappers, headers) {
  const maps = requiredColumns.map((colName, idx) => {
    return produceMapping(data, colName, dbMappers[idx], headers)
  })
  return Promise.all(maps).then((mappings) => {
    return mappings.map((mapData) => createHashMap(mapData))
  })
}

function mapNamesToID(data, requiredColumns, renamedColumns, hashMaps) {
  // https://stackoverflow.com/questions/46951390/dynamically-chain-methods-to-javascript-function
  // dataframe's map can only be called one at a time
  var dataFrame = data
  requiredColumns.map((colName, idx) => {
    dataFrame = dataFrame.map((row) => row.set(renamedColumns[idx], hashMaps[idx].get(row.get(colName))))
  })
  return dataFrame
}

function filterReqColumns(data, requiredColumns) {
  var dataFrame = data
  requiredColumns.map((colName, idx) => {
    dataFrame = dataFrame.filter((row) => row.get(colName) > 0)
  })
  return dataFrame
}

function renameColumns(data, requiredColumns, renamedColumns) {
  var dataFrame = data
  requiredColumns.map((colName, idx) => {
    dataFrame = dataFrame.rename(colName, renamedColumns[idx])
  })
  return dataFrame
}

function dropColumns(data, requiredColumns) {
  var dataFrame = data
  requiredColumns.map((colName, idx) => {
    dataFrame = dataFrame.drop(colName)
  })
  return dataFrame
}

function mapColumnsLocal(data, columnName, mappedColumnName, dbResponse) {
  const localMapper = createHashMap(dbResponse)
  return data.map((row) => row.set(mappedColumnName, localMapper.get(row.get(columnName))))
}

module.exports = {
  renameColumns,
  filterReqColumns,
  mapNamesToID,
  produceMappers,
  createHashMap,
  produceMapping,
  dropColumns,
  mapColumnsLocal,
}
