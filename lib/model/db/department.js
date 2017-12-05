"use strict";

var moment  = require('moment'),
    _       = require('underscore'),
    Promise = require('bluebird'),
    CalendarMonth = require('../calendar_month');

module.exports = function(sequelize, DataTypes) {
  var Department = sequelize.define("Department", {
      // TODO add validators!
      name : {
          type      : DataTypes.STRING,
          allowNull : false
      },
      allowance : {
          type         : DataTypes.INTEGER,
          allowNull    : false,
          defaultValue : 20,
      },
      include_public_holidays : {
          type         : DataTypes.BOOLEAN,
          allowNull    : false,
          defaultValue : true,
      }
  }, {
      indexes : [
        {
          fields : ['companyId'],
        },
        {
          fields : ['id'],
        }
      ],
      classMethods: {
          loadScope : function( models ) {

            Department.addScope(
              'with_simple_users',
              {
                include : [
                  { model : models.User, as : 'users' },
                ],
              }
            );

            Department.addScope(
              'with_boss',
              {
                include : [
                  { model : models.User, as : 'boss' },
                ]
              }
            );

            Department.addScope(
              'with_supervisors',
              {
                include : [
                  { model : models.User, as : 'supervisors' },
                ]
              }
            );
          },
          associate : function( models ) {
            // We have constrains OFF as to prevent ORM complaining about
            // cycle reference
            Department.belongsTo ( models.User,    { as : 'boss', constraints: false});
            Department.belongsTo ( models.Company, { as : 'company'});
            Department.hasMany   ( models.User,    { as : 'users'});

            Department.hasMany( models.DepartmentSupervisor, {
              as         : 'supervisors_link',
              foreignKey : 'department_id',
            });

            Department.belongsToMany(models.User, {
              as         : 'supervisors',
              foreignKey : 'department_id',
              otherKey   : 'user_id',
              through    : models.DepartmentSupervisor,
            });
          },

          default_order_field : function(){
              return 'name';
          },
      },

      instanceMethods : {

        // Return users related to current department and still active
        promise_active_users : function(){
          return this.getUsers({
            where : sequelize.models.User.get_active_user_filter()
          });
        },

        promise_team_view : function(args){

          var self  = this,
          model     = sequelize.models,
          base_date = args.base_date || moment();

          var promise_users_and_leaves = Promise.try(function(){
            return self.promise_active_users();
          })
          .then(function(users){

            return Promise.all(
              _.map(
                users,
                function(user){
                  return user.promise_my_leaves_for_calendar({
                    year : base_date,
                  })
                  .then(function(leaves){

                    var leave_days = _.flatten( _.map(leaves, function(leave){
                      return _.map( leave.get_days(), function(leave_day){
                        leave_day.leave = leave;
                        return leave_day;
                      });
                    }));

                    return user.promise_schedule_I_obey()
                      .then(function(schedule){
                        return Promise.resolve({
                          user       : user,
                          leave_days : leave_days,
                          schedule   : schedule,
                        });
                      });
                  });
                }
              ) // End of map
            ); // End of promise_users_and_leaves
          });

          var promise_company = self.getCompany({
            include:[
              { model : model.BankHoliday , as : 'bank_holidays' },
              { model : model.LeaveType   , as : 'leave_types' },
            ]
          });

          return Promise.join(
            promise_company,
            promise_users_and_leaves,
            function(company, users_and_leaves){
              _.each(users_and_leaves, function(user_data){
                var calendar_month = new CalendarMonth(base_date,{
                    bank_holidays :
                        self.include_public_holidays
                        ?  _.map(
                            company.bank_holidays,
                            function(day){return day.date}
                        )
                        : [],
                    leave_days : user_data.leave_days,
                    schedule   : user_data.schedule,
                });

                user_data.days = calendar_month.as_for_team_view();
              });

              return Promise.resolve(users_and_leaves);
            }
          );

        }, // End of promise_team_view

        // Return new department object that is based on same ID but include all supervisors
        promise_me_with_supervisors : function() {
          var self = this;

          return self.Model.scope('with_supervisors').findById( self.id );
        },
      }
  });

  return Department;
};
